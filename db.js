/**
 * db.js — Couche d'accès aux données (VERSION SUPABASE)
 * ------------------------------------------------------------
 * ⚠️ AVANT DE DÉPLOYER : remplacez SUPABASE_URL et SUPABASE_ANON_KEY
 * ci-dessous par les vraies valeurs de votre projet Supabase
 * (Settings → API dans le tableau de bord Supabase).
 *
 * Cette clé "anon" est faite pour être visible côté client (navigateur) —
 * ce n'est pas un secret, la vraie protection vient des règles RLS
 * définies dans schema-v1-mvp.sql. Ne mettez JAMAIS la "service_role key"
 * ici, elle ne doit jamais apparaître dans du code envoyé au navigateur.
 *
 * L'identité de la personne connectée reste mémorisée localement
 * (localStorage) en attendant une vraie authentification Supabase Auth ;
 * toutes les données métier (annonces, besoins, paiements...) viennent
 * maintenant réellement de Supabase et sont partagées entre tous les
 * visiteurs de l'app.
 * ------------------------------------------------------------
 */

const SUPABASE_URL = 'https://iaycxzbesjlrjwkynnbs.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlheWN4emJlc2pscmp3a3lubmJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2NjQ2MzIsImV4cCI6MjEwMDI0MDYzMn0.e8ynhFH70xfJAAfIM-1ujky-sdHbHeHHKOmi5gEgWG8';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CURRENT_USER_KEY = 'mc_current_user';

// ---------- API ----------
const db = {
  // -- PROFILS --
  async createProfile(profile) {
    const { data, error } = await supabaseClient
      .from('profiles')
      .insert([{ is_premium: false, ...profile }])
      .select()
      .single();
    if (!error) localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(data));
    return { data, error };
  },

  // Reste synchrone et local : on n'a pas encore de vraie session Supabase Auth.
  // On garde juste en mémoire "qui est connecté sur cet appareil".
  getCurrentUser() {
    const raw = localStorage.getItem(CURRENT_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  },

  async findProfileByPhone(phone) {
    const { data, error } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();
    return { data, error };
  },

  logout() {
    localStorage.removeItem(CURRENT_USER_KEY);
  },

  async updateProfile(userId, updates) {
    const { data, error } = await supabaseClient
      .from('profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select()
      .single();
    if (!error) {
      const currentUser = this.getCurrentUser();
      if (currentUser && currentUser.id === userId) {
        localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(data));
      }
    }
    return { data, error };
  },

  // -- PAIEMENTS (avec validation admin manuelle, en attendant l'API opérateur réelle) --
  async submitPaymentRequest({ userId, amount, provider, phone, reference }) {
    const { data, error } = await supabaseClient
      .from('payments')
      .insert([{
        user_id: userId, amount, provider, phone_used: phone,
        provider_reference: reference, status: 'pending',
      }])
      .select()
      .single();
    if (!error) {
      await this.createNotification(
        `Nouvelle demande de paiement de ${amount} FCFA en attente de validation`,
        { audience: 'admin' }
      );
    }
    return { data, error };
  },

  async listPendingPayments() {
    const { data, error } = await supabaseClient
      .from('payments')
      .select('*, profile:profiles(*)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    return { data: data || [], error };
  },

  async listAllPayments() {
    const { data, error } = await supabaseClient
      .from('payments')
      .select('*, profile:profiles(*)')
      .order('created_at', { ascending: false });
    return { data: data || [], error };
  },

  async approvePayment(paymentId) {
    const { data: payment, error: findErr } = await supabaseClient
      .from('payments').select('*').eq('id', paymentId).single();
    if (findErr || !payment) return { data: null, error: 'Paiement introuvable' };

    await supabaseClient.from('payments').update({ status: 'confirmed' }).eq('id', paymentId);
    await supabaseClient.from('profiles').update({
      is_premium: true, premium_since: new Date().toISOString(),
    }).eq('id', payment.user_id);

    const currentUser = this.getCurrentUser();
    if (currentUser && currentUser.id === payment.user_id) {
      const { data: refreshed } = await supabaseClient.from('profiles').select('*').eq('id', payment.user_id).single();
      if (refreshed) localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(refreshed));
    }

    await this.createNotification('🌟 Votre paiement a été validé — Premium activé !', {
      audience: 'user', target_user_id: payment.user_id,
    });
    return { data: payment, error: null };
  },

  async rejectPayment(paymentId, reason) {
    const { data: payment, error: findErr } = await supabaseClient
      .from('payments').select('*').eq('id', paymentId).single();
    if (findErr || !payment) return { data: null, error: 'Paiement introuvable' };

    await supabaseClient.from('payments').update({
      status: 'failed', reject_reason: reason || 'Référence introuvable',
    }).eq('id', paymentId);

    await this.createNotification(
      "Votre paiement n'a pas pu être validé (référence introuvable). Contactez-nous sur WhatsApp.",
      { audience: 'user', target_user_id: payment.user_id }
    );
    return { data: payment, error: null };
  },

  // -- ADMIN : vue d'ensemble des profils --
  async adminListProfiles() {
    const { data, error } = await supabaseClient
      .from('profiles').select('*').order('created_at', { ascending: false });
    return { data: data || [], error };
  },

  async adminDeleteProfile(userId) {
    const { error } = await supabaseClient.from('profiles').delete().eq('id', userId);
    return { data: !error, error };
  },

  async adminSetPremiumManual(userId, value) {
    const updates = { is_premium: value };
    if (value) updates.premium_since = new Date().toISOString();
    const { error } = await supabaseClient.from('profiles').update(updates).eq('id', userId);

    const currentUser = this.getCurrentUser();
    if (currentUser && currentUser.id === userId) {
      const { data: refreshed } = await supabaseClient.from('profiles').select('*').eq('id', userId).single();
      if (refreshed) localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(refreshed));
    }
    return { data: !error, error };
  },

  // -- ADMIN : modération de contenu (suppression) --
  async adminDeleteListing(id) {
    const { error } = await supabaseClient.from('listings').delete().eq('id', id);
    return { data: !error, error };
  },
  async adminDeleteNeed(id) {
    const { error } = await supabaseClient.from('needs').delete().eq('id', id);
    return { data: !error, error };
  },
  async adminDeleteIndustrial(id) {
    const { error } = await supabaseClient.from('industrial_posts').delete().eq('id', id);
    return { data: !error, error };
  },
  async adminDeleteQuestion(id) {
    const { error } = await supabaseClient.from('questions').delete().eq('id', id);
    return { data: !error, error };
  },

  // -- SUGGESTIONS --
  async submitSuggestion(name, message) {
    const { error } = await supabaseClient
      .from('suggestions').insert([{ name: name || 'Anonyme', message }]);
    if (!error) {
      await this.createNotification(`Nouvelle suggestion reçue de ${name || 'un utilisateur anonyme'}`, { audience: 'admin' });
    }
    return { data: !error, error };
  },
  async listSuggestions() {
    const { data, error } = await supabaseClient
      .from('suggestions').select('*').order('created_at', { ascending: false });
    return { data: data || [], error };
  },

  // -- ADMIN : diffusion groupée (simulée ; vraie API WhatsApp à l'étape suivante) --
  async adminBroadcast(message, target) {
    const { error } = await supabaseClient.from('broadcasts').insert([{ message, target }]);
    if (!error) {
      await this.createNotification(`📢 ${message}`, {
        audience: 'user', target_role: target === 'tous' ? null : target,
      });
    }
    return { data: !error, error };
  },
  async listBroadcasts() {
    const { data, error } = await supabaseClient
      .from('broadcasts').select('*').order('created_at', { ascending: false });
    return { data: data || [], error };
  },

  // -- ANNONCES DE VENTE --
  async listListings() {
    const { data, error } = await supabaseClient
      .from('listings').select('*').order('created_at', { ascending: false });
    return { data: data || [], error };
  },
  async createListing(listing) {
    const { data, error } = await supabaseClient
      .from('listings').insert([listing]).select().single();
    if (!error) {
      await this.createNotification(
        `Nouvelle annonce : ${listing.quantity} kg disponibles à ${listing.zone}`,
        { audience: 'user', target_role: 'acheteur', target_zone: listing.zone }
      );
    }
    return { data, error };
  },

  // -- BESOINS (achat) --
  async listNeeds() {
    const { data, error } = await supabaseClient
      .from('needs').select('*').order('created_at', { ascending: false });
    return { data: data || [], error };
  },
  async createNeed(need) {
    const { data, error } = await supabaseClient
      .from('needs').insert([need]).select().single();
    if (!error) {
      await this.createNotification(
        `${need.buyer_name} recherche ${need.quantity} kg à ${need.zone}`,
        { audience: 'user', target_role: 'producteur', target_zone: need.zone }
      );
    }
    return { data, error };
  },

  // -- INDUSTRIELS --
  async listIndustrial() {
    const { data, error } = await supabaseClient
      .from('industrial_posts').select('*').order('created_at', { ascending: false });
    return { data: data || [], error };
  },
  async createIndustrialPost(post) {
    const { data, error } = await supabaseClient
      .from('industrial_posts').insert([post]).select().single();
    return { data, error };
  },

  // -- QUESTIONS --
  async listQuestions() {
    const { data, error } = await supabaseClient
      .from('questions').select('*').order('created_at', { ascending: false });
    return { data: data || [], error };
  },
  async createQuestion(question) {
    const { data, error } = await supabaseClient
      .from('questions').insert([{ reply_count: 0, ...question }]).select().single();
    return { data, error };
  },

  // -- NOTIFICATIONS --
  // audience: 'admin' (visible uniquement dans l'espace admin) ou 'user' (visible dans la
  // cloche des utilisateurs, mais filtrée par pertinence : rôle, zone, ou utilisateur précis)
  async createNotification(message, options = {}) {
    await supabaseClient.from('notifications').insert([{
      message,
      audience: options.audience || 'admin',
      target_user_id: options.target_user_id || null,
      target_role: options.target_role || null,
      target_zone: options.target_zone || null,
    }]);
  },

  // Notifications pertinentes pour CET utilisateur précis (cloche utilisateur)
  async listNotificationsForUser(user) {
    let query = supabaseClient.from('notifications').select('*').eq('audience', 'user');
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) return { data: [], error };

    const relevant = (data || []).filter(n => {
      if (n.target_user_id) return user && n.target_user_id === user.id;
      if (n.target_role && (!user || n.target_role !== user.role)) return false;
      if (n.target_zone && (!user || n.target_zone !== user.zone)) return false;
      return true;
    });
    return { data: relevant, error: null };
  },

  // Notifications réservées à l'admin (nouvelles inscriptions, demandes de paiement,
  // suggestions...) — jamais montrées aux utilisateurs normaux
  async listAdminNotifications() {
    const { data, error } = await supabaseClient
      .from('notifications').select('*').eq('audience', 'admin').order('created_at', { ascending: false });
    return { data: data || [], error };
  },

  async markAllNotificationsRead(user) {
    const { data: relevant } = await this.listNotificationsForUser(user);
    const ids = (relevant || []).filter(n => !n.read).map(n => n.id);
    if (ids.length > 0) {
      await supabaseClient.from('notifications').update({ read: true }).in('id', ids);
    }
  },

  async unreadNotificationCount(user) {
    const { data } = await this.listNotificationsForUser(user);
    return data.filter(n => !n.read).length;
  },

  // -- GROUPEMENT DE VENTE --
  // Fusionne les annonces actives d'une zone en une annonce groupée unique,
  // et notifie les producteurs concernés.
  async proposeGroup(zone) {
    const { data: zoneListings, error } = await supabaseClient
      .from('listings').select('*').eq('zone', zone).eq('is_group_listing', false).eq('status', 'active');
    if (error) return { data: null, error: error.message };
    if (!zoneListings || zoneListings.length < 2) {
      return { data: null, error: 'Pas assez de producteurs dans cette zone' };
    }

    const totalQty = zoneListings.reduce((sum, r) => sum + Number(r.quantity), 0);
    const avgPrice = Math.round(zoneListings.reduce((sum, r) => sum + (Number(r.price_per_unit) || 0), 0) / zoneListings.length);
    const sellerNames = zoneListings.map(r => r.seller_name);
    const ids = zoneListings.map(r => r.id);

    await supabaseClient.from('listings').update({ status: 'groupe' }).in('id', ids);

    const { data: groupRow, error: groupErr } = await supabaseClient
      .from('listings')
      .insert([{
        seller_name: `Groupement (${zoneListings.length} producteurs)`,
        product_type: zoneListings[0].product_type,
        quantity: totalQty, unit: 'kg', price_per_unit: avgPrice || null,
        zone, region: zoneListings[0].region, is_group_listing: true, status: 'active',
      }])
      .select().single();

    if (!groupErr) {
      await this.createNotification(
        `🤝 Groupement créé à ${zone} : ${totalQty} kg réunis (${sellerNames.join(', ')})`,
        { audience: 'user', target_role: 'producteur', target_zone: zone }
      );
    }
    return { data: groupRow, error: groupErr ? groupErr.message : null };
  },

  // -- ZONES (agrégation calculée côté client à partir des annonces) --
  async zoneAvailability() {
    const { data: rows, error } = await supabaseClient
      .from('listings').select('*').neq('status', 'groupe');
    if (error) return { data: [], error };

    const byZone = {};
    (rows || []).forEach(r => {
      if (!byZone[r.zone]) byZone[r.zone] = { zone: r.zone, region: r.region, total: 0, sellers: new Set(), hasGroup: false };
      byZone[r.zone].total += Number(r.quantity) || 0;
      byZone[r.zone].sellers.add(r.seller_name);
      if (r.is_group_listing) byZone[r.zone].hasGroup = true;
    });
    const result = Object.values(byZone).map(z => ({
      zone: z.zone, region: z.region, total: z.total, producer_count: z.sellers.size,
      producers: Array.from(z.sellers), has_group: z.hasGroup,
    }));
    return { data: result, error: null };
  },
};
