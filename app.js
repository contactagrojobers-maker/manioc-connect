// ============================================
// app.js — Logique de l'application
// Toutes les données passent par db.js (voir ce fichier
// pour la note sur la migration vers Supabase)
// ============================================

// ============================================
// Inscription obligatoire UNIQUEMENT pour publier
// (vendre, publier un besoin, profil, abonnement)
// La navigation/consultation reste libre, sans compte
// ============================================
let PENDING_SCREEN = null;
let PENDING_TAB = null;

function requireAuth(targetScreen, targetTab) {
  const user = db.getCurrentUser();
  if (!user) {
    PENDING_SCREEN = targetScreen;
    PENDING_TAB = targetTab || null;
    showToast('Créez votre compte pour continuer');
    showScreen('bienvenue');
    return false;
  }
  return true;
}

function handleNavProtected(screenName) {
  if (requireAuth(screenName)) showScreen(screenName);
}

// ---------- NORMALISATION DES ZONES ----------
// Pas de liste figée de zones : on harmonise simplement l'écriture pour que
// "ntui", "NTUI", "Ntui " soient reconnus comme la même zone, sans jamais
// bloquer un nom de zone qui n'existerait pas dans une liste prédéfinie.
function normalizeZoneName(raw) {
  if (!raw) return raw;
  let s = raw.trim().replace(/\s+/g, ' ');
  s = s.replace(/[’‘`´]/g, "'"); // unifie les apostrophes
  s = s.split(' ').map(word => {
    if (!word) return word;
    return word.split('-').map(part => {
      if (!part) return part;
      if (part === '&') return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    }).join('-');
  }).join(' ');
  return s;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  document.querySelectorAll('.navbtn').forEach(b => b.classList.remove('active'));
  const navBtn = document.querySelector('.navbtn[data-nav="' + name + '"]');
  if (navBtn) navBtn.classList.add('active');

  document.querySelector('.app-shell').classList.toggle('admin-active', name === 'admin');

  if (name === 'accueil') renderHome();
  if (name === 'acheter') renderBuyListings();
  if (name === 'profil') renderProfile();
  if (name === 'industriels') renderIndustrial();
  if (name === 'questions') renderQuestions();
  if (name === 'admin') renderAdminDashboard();
  window.scrollTo(0, 0);
}

// chip selection (single choice within a group)
document.querySelectorAll('.choice-row').forEach(row => {
  row.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    if (row.dataset.multi === 'true') {
      chip.classList.toggle('selected');
    } else {
      row.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
    }
  });
});
document.querySelectorAll('.pay-options').forEach(row => {
  row.addEventListener('click', e => {
    const opt = e.target.closest('.pay-option');
    if (opt) {
      row.querySelectorAll('.pay-option').forEach(c => c.classList.remove('selected'));
      opt.classList.add('selected');
      const num = opt.dataset.number;
      const numEl = document.getElementById('pay-recipient-number');
      if (num && numEl) numEl.textContent = num.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
    }
  });
});

function getSelectedValue(containerId) {
  const el = document.querySelector('#' + containerId + ' .selected');
  return el ? el.dataset.value : null;
}

// ---------- VALIDATION NUMÉRO CAMEROUNAIS ----------
// Format basique : 9 chiffres commençant par 6, 2e chiffre entre 5 et 9
// (couvre la majorité des plages Orange/MTN actuelles). Une vraie
// vérification d'opérateur se ferait via l'API du fournisseur en prod.
function normalizeCMPhone(raw) {
  let digits = raw.replace(/[^\d]/g, '');
  if (digits.startsWith('237')) digits = digits.slice(3);
  return digits;
}
function isValidCMPhone(raw) {
  const digits = normalizeCMPhone(raw);
  return /^6[5-9]\d{7}$/.test(digits);
}

let PENDING_OTP_CODE = null;

function handleRegisterStart() {
  const phone = document.getElementById('reg-phone').value.trim();
  const name = document.getElementById('reg-name').value.trim();
  const zone = document.getElementById('reg-zone').value.trim();
  const statusEl = document.getElementById('reg-phone-status');

  if (!name || !zone) { showToast('Merci de remplir tous les champs'); return; }

  if (!isValidCMPhone(phone)) {
    statusEl.textContent = '⚠️ Numéro invalide. Format attendu : 6XXXXXXXX (9 chiffres, opérateur camerounais)';
    statusEl.style.color = 'var(--terracotta)';
    return;
  }
  statusEl.textContent = '';

  // Simule l'envoi d'un code SMS (en production : vrai fournisseur SMS/OTP)
  PENDING_OTP_CODE = String(Math.floor(1000 + Math.random() * 9000));
  document.getElementById('reg-step-form').style.display = 'none';
  document.getElementById('reg-step-otp').style.display = 'block';
  document.getElementById('otp-demo-hint').textContent = `Mode démo — votre code : ${PENDING_OTP_CODE}`;
  showToast('Code de vérification envoyé par SMS');
}

function handleVerifyOtp() {
  const entered = document.getElementById('otp-input').value.trim();
  if (entered !== PENDING_OTP_CODE) {
    showToast('Code incorrect, réessayez');
    return;
  }
  handleRegister();
}

async function handleLogin() {
  const phoneRaw = document.getElementById('login-phone').value.trim();
  const errorEl = document.getElementById('login-error');
  const normalized = normalizeCMPhone(phoneRaw);

  const { data: profile } = await db.findProfileByPhone(normalized);
  if (!profile) {
    errorEl.textContent = "Aucun compte trouvé avec ce numéro. Vérifiez, ou inscrivez-vous.";
    return;
  }
  localStorage.setItem('mc_current_user', JSON.stringify(profile));
  errorEl.textContent = '';
  document.getElementById('login-phone').value = '';
  showToast(`Bon retour, ${profile.full_name.split(' ')[0]} 👋`);
  updateNotifBadge();
  updateProfileNavIcon();
  afterAuthContinue();
}

function handleLogout() {
  db.logout();
  showToast('Vous êtes déconnecté');
  updateNotifBadge();
  updateProfileNavIcon();
  showScreen('accueil');
}

// ---------- INSCRIPTION ----------
async function handleRegister() {
  const name = document.getElementById('reg-name').value.trim();
  const phone = normalizeCMPhone(document.getElementById('reg-phone').value.trim());
  const role = getSelectedValue('reg-role');
  const zone = normalizeZoneName(document.getElementById('reg-zone').value.trim());
  const marketingOptIn = document.getElementById('reg-consent').checked;

  await db.createProfile({ full_name: name, phone, phone_verified: true, role, zone, marketing_opt_in: marketingOptIn });
  // Réinitialise le formulaire d'inscription pour la prochaine fois
  document.getElementById('reg-step-otp').style.display = 'none';
  document.getElementById('reg-step-form').style.display = 'block';
  document.getElementById('otp-input').value = '';
  showToast('Compte créé et numéro vérifié ✓');
  updateNotifBadge();
  updateProfileNavIcon();
  showScreen('abonnement');
}

function afterAuthContinue() {
  const screen = PENDING_SCREEN || 'accueil';
  const tab = PENDING_TAB;
  PENDING_SCREEN = null; PENDING_TAB = null;
  showScreen(screen);
  if (screen === 'acheter' && tab) switchBuyTab(tab);
}

// ---------- PAIEMENT ----------
async function handlePayment() {
  const user = db.getCurrentUser();
  if (!user) { showScreen('bienvenue'); return; }

  const provider = getSelectedValue('pay-options');
  const phone = document.getElementById('pay-phone').value.trim();
  const reference = document.getElementById('pay-reference').value.trim();

  if (!phone || !reference) { showToast('Merci de renseigner votre numéro et la référence de transaction'); return; }

  await db.submitPaymentRequest({ userId: user.id, amount: 4000, provider, phone, reference });
  showToast('Paiement enregistré — en attente de validation ✓');
  updateNotifBadge();
  afterAuthContinue();
}

// ---------- VENDRE ----------
async function handleCreateListing() {
  if (!requireAuth('vendre')) return;
  const user = db.getCurrentUser();
  const product_type = getSelectedValue('sell-product');
  const quantity = parseFloat(document.getElementById('sell-qty').value);
  const price_per_unit = parseFloat(document.getElementById('sell-price').value) || null;
  const zone = normalizeZoneName(document.getElementById('sell-zone').value.trim());

  if (!quantity || !zone) { showToast('Merci de remplir la quantité et la zone'); return; }

  await db.createListing({
    seller_name: user ? user.full_name : 'Anonyme',
    product_type, quantity, unit: 'kg', price_per_unit, zone, region: zone,
  });
  showToast('Annonce publiée ✓');
  updateNotifBadge();
  showScreen('accueil');
}

// ---------- ACHETER : onglets ----------
function switchBuyTab(tab) {
  if (tab === 'besoin' && !requireAuth('acheter', 'besoin')) return;
  document.getElementById('tab-dispo').classList.toggle('active', tab === 'dispo');
  document.getElementById('tab-besoin').classList.toggle('active', tab === 'besoin');
  document.getElementById('buyview-dispo').style.display = tab === 'dispo' ? 'block' : 'none';
  document.getElementById('buyview-besoin').style.display = tab === 'besoin' ? 'block' : 'none';
}

const PRODUCT_LABELS = {
  racine_fraiche: 'Racine fraîche', gari: 'Gari', baton: 'Bâton de manioc', farine: 'Farine',
};
const PRODUCT_EMOJI = {
  racine_fraiche: '🌾', gari: '🫓', baton: '🥖', farine: '🌾',
};

async function renderBuyListings() {
  const { data: listings } = await db.listListings();
  const container = document.getElementById('buy-listings');
  container.innerHTML = listings.map(l => `
    <div class="listing">
      <div class="thumb">${PRODUCT_EMOJI[l.product_type] || '🌾'}</div>
      <div class="info">
        <div class="title">${PRODUCT_LABELS[l.product_type] || l.product_type} — ${l.quantity} ${l.unit}</div>
        <div class="meta">📍 ${l.zone} · ${l.seller_name}${l.is_group_listing ? ' (groupement)' : ''}</div>
        ${l.price_per_unit ? `<div class="price">${l.price_per_unit} FCFA / ${l.unit}</div>` : ''}
      </div>
      <button class="call-btn">📞</button>
    </div>
  `).join('') || '<p style="color:var(--ink-soft);font-size:13px;">Aucune annonce pour le moment.</p>';
}

// ---------- PUBLIER UN BESOIN ----------
async function handleCreateNeed() {
  if (!requireAuth('acheter', 'besoin')) return;
  const user = db.getCurrentUser();
  const product_type = getSelectedValue('need-product');
  const quantity = parseFloat(document.getElementById('need-qty').value);
  const budget_per_unit = document.getElementById('need-budget').value.trim();
  const zone = normalizeZoneName(document.getElementById('need-zone').value.trim());
  const quality_specs = [getSelectedValue('need-quality')];
  const quality_notes = document.getElementById('need-quality-notes').value.trim();
  const payment_terms = getSelectedValue('need-payment');
  const is_urgent = getSelectedValue('need-urgency') === 'true';

  if (!quantity || !zone) { showToast('Merci de remplir la quantité et la zone'); return; }

  await db.createNeed({
    buyer_name: user ? user.full_name : 'Anonyme',
    product_type, quantity, unit: 'kg', budget_per_unit, zone, region: zone,
    quality_specs, quality_notes, payment_terms, is_urgent,
  });
  showToast('Besoin publié — visible par les producteurs de votre zone ✓');
  updateNotifBadge();
  showScreen('accueil');
}

// ---------- ACCUEIL : rendu dynamique ----------
async function renderHome() {
  const user = db.getCurrentUser();
  document.getElementById('home-greeting').textContent = user ? `Bonjour ${user.full_name.split(' ')[0]} 👋` : 'Bonjour 👋';

  const banner = document.getElementById('premium-banner');
  banner.style.display = (!user || user.is_premium) ? 'none' : 'flex';

  const { data: needs } = await db.listNeeds();
  const needsHtml = needs.slice(0, 4).map(n => `
    <div class="need-card">
      <div>
        <div class="title">${n.quantity} ${n.unit} de ${(PRODUCT_LABELS[n.product_type] || n.product_type).toLowerCase()}</div>
        <div class="meta">📍 ${n.zone} · ${n.buyer_name}</div>
        ${n.is_urgent ? '<span class="need-urgent">🔥 Urgent</span>' : ''}
      </div>
      <button class="call-btn">📞</button>
    </div>
  `).join('') || '<p style="color:var(--ink-soft);font-size:13px;">Aucun besoin publié pour le moment.</p>';
  document.getElementById('home-needs-list').innerHTML = needsHtml;

  const { data: zones } = await db.zoneAvailability();
  const zonesHtml = zones.map(z => `
    <div class="zone-card">
      <div class="zone-head">
        <div class="zone-name">📍 ${z.zone}${z.region ? ', ' + z.region : ''}</div>
        <div class="zone-vol">${z.total} kg dispo</div>
      </div>
      <p style="font-size:11.5px;color:var(--ink-soft);margin:0 0 8px;">${z.producer_count} producteur${z.producer_count > 1 ? 's' : ''} actif${z.producer_count > 1 ? 's' : ''}</p>
      ${z.has_group
        ? '<div style="font-size:11.5px;font-weight:700;color:var(--leaf-dark);background:var(--cream-2);padding:8px 10px;border-radius:10px;text-align:center;">✅ Groupement déjà actif dans cette zone</div>'
        : (z.producer_count > 1 ? `<button class="group-cta" onclick="handleProposeGroup('${z.zone.replace(/'/g, "\\'")}')">🤝 Proposer un groupement de vente</button>` : '')}
    </div>
  `).join('') || '<p style="color:var(--ink-soft);font-size:13px;">Pas encore de données par zone.</p>';
  document.getElementById('home-zones-list').innerHTML = zonesHtml;
}

async function handleProposeGroup(zone) {
  if (!requireAuth('accueil')) return;
  const { data, error } = await db.proposeGroup(zone);
  if (error) { showToast(error); return; }
  showToast(`Groupement créé pour ${zone} ✓`);
  updateNotifBadge();
  renderHome();
}

// ---------- INDUSTRIELS ----------
async function renderIndustrial() {
  const { data: posts } = await db.listIndustrial();
  const container = document.getElementById('industrial-listings');
  container.innerHTML = posts.map(p => `
    <div class="listing">
      <div class="thumb">🏭</div>
      <div class="info">
        <div class="title">${p.company_name}</div>
        <div class="meta">${p.post_type === 'achete' ? 'Achète' : 'Vend'} · ${p.description}${p.volume ? ' · ' + p.volume : ''}</div>
        <div class="price">Zone : ${p.zone}</div>
      </div>
      <button class="call-btn">📞</button>
    </div>
  `).join('') || '<p style="color:var(--ink-soft);font-size:13px;">Aucune annonce industrielle pour le moment.</p>';
}

async function handleCreateIndustrial() {
  if (!requireAuth('industriels')) return;
  const company_name = document.getElementById('ind-company').value.trim();
  const post_type = getSelectedValue('ind-type');
  const description = document.getElementById('ind-description').value.trim();
  const volume = document.getElementById('ind-volume').value.trim();
  const zone = normalizeZoneName(document.getElementById('ind-zone').value.trim());

  if (!company_name || !description || !zone) { showToast('Merci de remplir les champs requis'); return; }

  await db.createIndustrialPost({ company_name, post_type, description, volume, zone });
  showToast('Annonce industrielle publiée ✓');
  renderIndustrial();
  document.getElementById('ind-company').value = '';
  document.getElementById('ind-description').value = '';
  document.getElementById('ind-volume').value = '';
  document.getElementById('ind-zone').value = '';
}

// ---------- QUESTIONS ----------
const TAG_LABELS = { maladie: '🌱 Maladie', variete: '🌾 Variété', marche: '💰 Marché', autre: 'Autre' };

async function renderQuestions() {
  const { data: questions } = await db.listQuestions();
  const container = document.getElementById('questions-list');
  container.innerHTML = questions.map(q => `
    <div class="need-card" style="border-left-color:var(--leaf);">
      <div>
        <div class="title">${q.title}</div>
        <div class="meta">${q.author_name} · Zone : ${q.zone}</div>
        <span class="need-urgent" style="color:var(--leaf-dark); background:var(--cream-2);">${TAG_LABELS[q.tag] || q.tag} · ${q.reply_count || 0} réponse${(q.reply_count || 0) > 1 ? 's' : ''}</span>
      </div>
    </div>
  `).join('') || '<p style="color:var(--ink-soft);font-size:13px;">Aucune question pour le moment.</p>';
}

async function handleCreateQuestion() {
  if (!requireAuth('questions')) return;
  const user = db.getCurrentUser();
  const title = document.getElementById('q-title').value.trim();
  const body = document.getElementById('q-body').value.trim();
  const zone = normalizeZoneName(document.getElementById('q-zone').value.trim());
  const tag = getSelectedValue('q-tag');

  if (!title || !zone) { showToast('Merci de remplir la question et la zone'); return; }

  await db.createQuestion({ author_name: user ? user.full_name : 'Anonyme', title, body, zone, tag });
  showToast('Question publiée ✓');
  renderQuestions();
  document.getElementById('q-title').value = '';
  document.getElementById('q-body').value = '';
  document.getElementById('q-zone').value = '';
}

// ---------- NOTIFICATIONS ----------
async function toggleNotifications() {
  const panel = document.getElementById('notif-panel');
  const isOpen = panel.classList.contains('open');
  if (isOpen) { panel.classList.remove('open'); return; }

  const user = db.getCurrentUser();
  const { data: notifs } = await db.listNotificationsForUser(user);
  document.getElementById('notif-list').innerHTML = notifs.map(n => `
    <div class="notif-item ${n.read ? '' : 'unread'}">
      <div class="notif-msg">${n.message}</div>
      <div class="notif-time">${timeAgo(n.created_at)}</div>
    </div>
  `).join('') || '<p style="color:var(--ink-soft);font-size:13px;padding:10px;">Aucune notification pour le moment.</p>';

  panel.classList.add('open');
  await db.markAllNotificationsRead(user);
  updateNotifBadge();
}

function timeAgo(ts) {
  const diffMin = Math.floor((Date.now() - ts) / 60000);
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH} h`;
  return `il y a ${Math.floor(diffH / 24)} j`;
}

async function updateNotifBadge() {
  const user = db.getCurrentUser();
  const count = await db.unreadNotificationCount(user);
  const badge = document.getElementById('notif-badge');
  if (count > 0) { badge.textContent = count > 9 ? '9+' : count; badge.style.display = 'flex'; }
  else { badge.style.display = 'none'; }
}

// ============================================
// ESPACE ADMIN
// ⚠️ IMPORTANT : ce mot de passe est stocké côté client, uniquement pour
// la démonstration. En production, l'authentification admin doit passer
// par Supabase Auth + vérification côté serveur (RLS), jamais un mot de
// passe visible dans le code JavaScript du navigateur.
// ============================================
const ADMIN_PASSWORD_DEMO = 'manioc2026';
let ADMIN_UNLOCKED = false;

function handleAdminLogin() {
  const pw = document.getElementById('admin-password').value;
  if (pw !== ADMIN_PASSWORD_DEMO) {
    document.getElementById('admin-login-error').textContent = 'Mot de passe incorrect';
    return;
  }
  ADMIN_UNLOCKED = true;
  document.getElementById('admin-password').value = '';
  document.getElementById('admin-login-error').textContent = '';
  showScreen('admin');
}

function switchAdminTab(tab) {
  document.querySelectorAll('.admin-side-btn').forEach(b => b.classList.toggle('active', b.dataset.atab === tab));
  ['overview', 'users', 'content', 'payments', 'broadcast', 'suggestions'].forEach(t => {
    document.getElementById('admin-view-' + t).style.display = (t === tab) ? 'block' : 'none';
  });
  if (tab === 'users') renderAdminUsers();
  if (tab === 'content') renderAdminContent();
  if (tab === 'payments') renderAdminPayments();
  if (tab === 'broadcast') renderAdminBroadcastHistory();
  if (tab === 'suggestions') renderAdminSuggestions();
}

async function renderAdminSuggestions() {
  const { data: suggestions } = await db.listSuggestions();
  document.getElementById('admin-suggestions-list').innerHTML = suggestions.map(s => `
    <div class="admin-content-card">
      <div class="title" style="font-size:12.5px;">${s.message}</div>
      <div class="meta">${s.name} · ${timeAgo(s.created_at)}</div>
    </div>
  `).join('') || '<p style="color:var(--ink-soft);font-size:13px;">Aucune suggestion reçue pour le moment.</p>';
}

async function renderAdminDashboard() {
  if (!ADMIN_UNLOCKED) { showScreen('admin-login'); return; }

  const { data: profiles } = await db.adminListProfiles();
  const { data: pendingPayments } = await db.listPendingPayments();
  const { data: listings } = await db.listListings();
  const { data: needs } = await db.listNeeds();
  const { data: questions } = await db.listQuestions();

  document.getElementById('admin-stat-total').textContent = profiles.length;
  document.getElementById('admin-stat-premium').textContent = profiles.filter(p => p.is_premium).length;
  document.getElementById('admin-stat-pending').textContent = pendingPayments.length;
  document.getElementById('admin-stat-listings').textContent = listings.length;
  document.getElementById('admin-stat-needs').textContent = needs.length;
  document.getElementById('admin-stat-questions').textContent = questions.length;

  document.getElementById('admin-pending-payments').innerHTML = renderPendingPaymentCards(pendingPayments);

  const { data: adminLog } = await db.listAdminNotifications();
  document.getElementById('admin-activity-log').innerHTML = adminLog.slice(0, 10).map(n => `
    <div class="admin-content-card">
      <div class="title" style="font-size:12.5px;">${n.message}</div>
      <div class="meta">${timeAgo(n.created_at)}</div>
    </div>
  `).join('') || '<p style="color:var(--ink-soft);font-size:13px;">Aucune activité récente.</p>';
}

function renderPendingPaymentCards(pendingPayments) {
  return pendingPayments.map(p => `
    <div class="admin-payment-card">
      <div class="row"><span>Client</span><b>${p.profile ? p.profile.full_name : 'Inconnu'}</b></div>
      <div class="row"><span>Téléphone</span><b>${p.profile ? formatCMPhone(p.profile.phone) : '—'}</b></div>
      <div class="row"><span>Montant</span><b>${p.amount} FCFA</b></div>
      <div class="row"><span>Opérateur</span><b>${p.provider === 'orange_money' ? 'Orange Money' : 'MTN MoMo'}</b></div>
      <div class="row"><span>Référence</span><b>${p.provider_reference}</b></div>
      <div class="admin-payment-actions">
        <button class="btn-approve" onclick="handleApprovePayment('${p.id}')">✓ Valider</button>
        <button class="btn-reject" onclick="handleRejectPayment('${p.id}')">✕ Rejeter</button>
      </div>
    </div>
  `).join('') || '<p style="color:var(--ink-soft);font-size:13px;">Aucun paiement en attente.</p>';
}

// ---------- ADMIN : UTILISATEURS (pouvoir complet) ----------
async function renderAdminUsers() {
  const { data: profiles } = await db.adminListProfiles();
  const search = (document.getElementById('admin-user-search')?.value || '').toLowerCase();
  const filtered = profiles.filter(p =>
    !search || p.full_name.toLowerCase().includes(search) || p.phone.includes(search) || p.zone.toLowerCase().includes(search)
  );

  document.getElementById('admin-all-users').innerHTML = filtered.map(p => `
    <div class="admin-content-card">
      <div class="top-row">
        <div>
          <div class="title">${p.full_name} ${p.is_premium ? '⭐' : ''}</div>
          <div class="meta">${ROLE_LABELS[p.role] || p.role} · ${p.zone} · ${formatCMPhone(p.phone)}</div>
        </div>
        <a href="https://wa.me/237${p.phone}" target="_blank" class="admin-mini-btn">💬</a>
      </div>
      <div class="admin-user-actions">
        <button class="admin-mini-btn premium-on" onclick="handleAdminTogglePremium('${p.id}', ${!p.is_premium})">${p.is_premium ? '⭐ Retirer Premium' : '⭐ Activer Premium'}</button>
        <button class="admin-mini-btn danger" onclick="handleAdminDeleteUser('${p.id}', '${p.full_name.replace(/'/g, "\\'")}')">🗑️ Supprimer le compte</button>
      </div>
    </div>
  `).join('') || '<p style="color:var(--ink-soft);font-size:13px;">Aucun utilisateur trouvé.</p>';
}

async function handleAdminTogglePremium(userId, value) {
  await db.adminSetPremiumManual(userId, value);
  showToast(value ? 'Premium activé manuellement ✓' : 'Premium retiré');
  renderAdminUsers();
}

async function handleAdminDeleteUser(userId, name) {
  if (!confirm(`Supprimer définitivement le compte de ${name} ?`)) return;
  await db.adminDeleteProfile(userId);
  showToast('Compte supprimé');
  renderAdminUsers();
}

// ---------- ADMIN : MODÉRATION DE CONTENU ----------
function switchContentTab(tab) {
  ['listings', 'needs', 'industrial', 'questions'].forEach(t => {
    document.getElementById('ctab-' + t).classList.toggle('active', t === tab);
    document.getElementById('admin-content-' + t).style.display = (t === tab) ? 'block' : 'none';
  });
}

async function renderAdminContent() {
  const { data: listings } = await db.listListings();
  document.getElementById('admin-content-listings').innerHTML = listings.map(l => `
    <div class="admin-content-card">
      <div class="top-row">
        <div>
          <div class="title">${PRODUCT_LABELS[l.product_type] || l.product_type} — ${l.quantity} ${l.unit}</div>
          <div class="meta">${l.seller_name} · ${l.zone}${l.price_per_unit ? ' · ' + l.price_per_unit + ' FCFA' : ''}</div>
        </div>
        <button class="admin-delete-btn" onclick="handleAdminDeleteContent('listing','${l.id}')">🗑️</button>
      </div>
    </div>
  `).join('') || '<p style="color:var(--ink-soft);font-size:13px;">Aucune annonce.</p>';

  const { data: needs } = await db.listNeeds();
  document.getElementById('admin-content-needs').innerHTML = needs.map(n => `
    <div class="admin-content-card">
      <div class="top-row">
        <div>
          <div class="title">${n.quantity} ${n.unit} de ${(PRODUCT_LABELS[n.product_type] || n.product_type).toLowerCase()}</div>
          <div class="meta">${n.buyer_name} · ${n.zone}${n.is_urgent ? ' · 🔥 Urgent' : ''}</div>
        </div>
        <button class="admin-delete-btn" onclick="handleAdminDeleteContent('need','${n.id}')">🗑️</button>
      </div>
    </div>
  `).join('') || '<p style="color:var(--ink-soft);font-size:13px;">Aucun besoin.</p>';

  const { data: industrial } = await db.listIndustrial();
  document.getElementById('admin-content-industrial').innerHTML = industrial.map(p => `
    <div class="admin-content-card">
      <div class="top-row">
        <div>
          <div class="title">${p.company_name}</div>
          <div class="meta">${p.post_type === 'achete' ? 'Achète' : 'Vend'} · ${p.description} · ${p.zone}</div>
        </div>
        <button class="admin-delete-btn" onclick="handleAdminDeleteContent('industrial','${p.id}')">🗑️</button>
      </div>
    </div>
  `).join('') || '<p style="color:var(--ink-soft);font-size:13px;">Aucune annonce industrielle.</p>';

  const { data: questions } = await db.listQuestions();
  document.getElementById('admin-content-questions').innerHTML = questions.map(q => `
    <div class="admin-content-card">
      <div class="top-row">
        <div>
          <div class="title">${q.title}</div>
          <div class="meta">${q.author_name} · ${q.zone}</div>
        </div>
        <button class="admin-delete-btn" onclick="handleAdminDeleteContent('question','${q.id}')">🗑️</button>
      </div>
    </div>
  `).join('') || '<p style="color:var(--ink-soft);font-size:13px;">Aucune question.</p>';
}

async function handleAdminDeleteContent(type, id) {
  if (!confirm('Supprimer ce contenu définitivement ?')) return;
  if (type === 'listing') await db.adminDeleteListing(id);
  if (type === 'need') await db.adminDeleteNeed(id);
  if (type === 'industrial') await db.adminDeleteIndustrial(id);
  if (type === 'question') await db.adminDeleteQuestion(id);
  showToast('Contenu supprimé');
  renderAdminContent();
}

// ---------- ADMIN : PAIEMENTS (vue complète) ----------
async function renderAdminPayments() {
  const { data: pending } = await db.listPendingPayments();
  document.getElementById('admin-payments-pending-full').innerHTML = renderPendingPaymentCards(pending);

  const { data: all } = await db.listAllPayments();
  const STATUS_LABELS = { pending: '⏳ En attente', confirmed: '✅ Validé', failed: '✕ Rejeté' };
  document.getElementById('admin-payments-history').innerHTML = all.map(p => `
    <div class="admin-user-row">
      <div>
        <b>${p.profile ? p.profile.full_name : 'Inconnu'}</b>
        <div class="meta">${p.amount} FCFA · ${p.provider_reference} · ${STATUS_LABELS[p.status]}</div>
      </div>
    </div>
  `).join('') || '<p style="color:var(--ink-soft);font-size:13px;">Aucun paiement enregistré.</p>';
}

// ---------- ADMIN : DIFFUSION ----------
async function handleBroadcast() {
  const message = document.getElementById('broadcast-message').value.trim();
  const target = getSelectedValue('broadcast-target') || 'tous';
  if (!message) { showToast('Écrivez un message avant d\'envoyer'); return; }
  await db.adminBroadcast(message, target);
  showToast('Diffusion envoyée ✓');
  document.getElementById('broadcast-message').value = '';
  updateNotifBadge();
  renderAdminBroadcastHistory();
}

async function renderAdminBroadcastHistory() {
  const { data: broadcasts } = await db.listBroadcasts();
  document.getElementById('admin-broadcast-history').innerHTML = broadcasts.map(b => `
    <div class="admin-content-card">
      <div class="title" style="font-size:12.5px;">${b.message}</div>
      <div class="meta">Cible : ${b.target} · ${timeAgo(b.created_at)}</div>
    </div>
  `).join('') || '<p style="color:var(--ink-soft);font-size:13px;">Aucune diffusion envoyée pour le moment.</p>';
}

async function handleApprovePayment(paymentId) {
  await db.approvePayment(paymentId);
  showToast('Paiement validé — Premium activé ✓');
  renderAdminDashboard();
  renderAdminPayments();
}

async function handleRejectPayment(paymentId) {
  await db.rejectPayment(paymentId);
  showToast('Paiement rejeté');
  renderAdminDashboard();
  renderAdminPayments();
}

// ---------- SUGGESTIONS ----------
async function handleSubmitSuggestion() {
  const name = document.getElementById('suggestion-name').value.trim();
  const message = document.getElementById('suggestion-message').value.trim();
  if (!message) { showToast('Écrivez votre suggestion avant d\'envoyer'); return; }
  await db.submitSuggestion(name, message);
  showToast('Merci pour votre suggestion ✓');
  document.getElementById('suggestion-name').value = '';
  document.getElementById('suggestion-message').value = '';
}

// ---------- PHOTO DE PROFIL ----------
function handleAvatarUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const user = db.getCurrentUser();
  if (!user) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = async () => {
      // Redimensionne à 200x200 max pour ne pas alourdir le stockage
      const size = 200;
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      const scale = Math.max(size / img.width, size / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);

      await db.updateProfile(user.id, { avatar_url: dataUrl });
      showToast('Photo de profil mise à jour ✓');
      renderProfile();
      updateProfileNavIcon();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ---------- ICÔNE PROFIL (connecté / non connecté) ----------
function updateProfileNavIcon() {
  const user = db.getCurrentUser();
  const iconEl = document.getElementById('profile-nav-icon');
  const dotEl = document.getElementById('conn-dot');
  if (!iconEl || !dotEl) return;

  dotEl.classList.toggle('online', !!user);

  if (user) {
    if (user.avatar_url) {
      iconEl.innerHTML = `<img src="${user.avatar_url}" class="avatar-photo"><span class="conn-dot online" id="conn-dot"></span>`;
    } else {
      const initials = user.full_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      iconEl.innerHTML = `<span style="font-size:12px;font-weight:800;">${initials}</span><span class="conn-dot online" id="conn-dot"></span>`;
    }
  } else {
    iconEl.innerHTML = `👤<span class="conn-dot" id="conn-dot"></span>`;
  }
}

// ---------- PROFIL ----------
const ROLE_LABELS = { producteur: '🌾 Producteur', acheteur: '🛒 Acheteur', industriel: '🏭 Industriel' };
const FARMSIZE_LABELS = { '<1ha': 'Moins de 1 ha', '1-3ha': '1 à 3 ha', '>3ha': 'Plus de 3 ha' };
const INTEREST_LABELS = { formation: '📚 Formations', boutures: '🌱 Boutures', financement: '💰 Financement' };
const BUYERTYPE_LABELS = { particulier: 'Particulier', commercant: 'Commerçant', transformateur: 'Transformateur' };
const PURCHASE_VOL_LABELS = { '<100kg': 'Moins de 100 kg/semaine', '100-500kg': '100 à 500 kg/semaine', '>500kg': 'Plus de 500 kg/semaine' };

function renderProfile() {
  const user = db.getCurrentUser();
  if (!user) return;
  const initials = user.full_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const avatarEl = document.getElementById('profil-avatar');
  avatarEl.innerHTML = user.avatar_url ? `<img src="${user.avatar_url}" class="avatar-photo">` : initials;
  document.getElementById('profil-name').textContent = user.full_name;
  document.getElementById('profil-badge').innerHTML = `<span class="flag">${user.role === 'producteur' ? '🌾' : user.role === 'acheteur' ? '🛒' : '🏭'}</span> ${user.role} · ${user.zone}${user.is_premium ? ' · ⭐ Premium' : ''}`;

  document.getElementById('pv-name').textContent = user.full_name;
  document.getElementById('pv-phone').textContent = formatCMPhone(user.phone) + (user.phone_verified ? ' ✅' : ' ⚠️ non vérifié');
  document.getElementById('pv-role').textContent = ROLE_LABELS[user.role] || user.role;
  document.getElementById('pv-zone').textContent = user.zone;

  // Affiche uniquement le bloc correspondant au rôle
  ['producteur', 'acheteur', 'industriel'].forEach(r => {
    document.getElementById('pv-block-' + r).style.display = (user.role === r) ? 'block' : 'none';
  });

  if (user.role === 'producteur') {
    document.getElementById('pv-varieties').textContent = (user.varieties && user.varieties.length) ? user.varieties.join(', ') : '—';
    document.getElementById('pv-farmsize').textContent = user.farm_size_range ? FARMSIZE_LABELS[user.farm_size_range] : '—';
    document.getElementById('pv-interests').textContent = (user.interests && user.interests.length) ? user.interests.map(i => INTEREST_LABELS[i] || i).join(', ') : '—';
  } else if (user.role === 'acheteur') {
    document.getElementById('pv-buyertype').textContent = user.buyer_type ? BUYERTYPE_LABELS[user.buyer_type] : '—';
    document.getElementById('pv-products-wanted').textContent = (user.products_wanted && user.products_wanted.length) ? user.products_wanted.map(p => PRODUCT_LABELS[p] || p).join(', ') : '—';
    document.getElementById('pv-purchase-volume').textContent = user.purchase_volume ? PURCHASE_VOL_LABELS[user.purchase_volume] : '—';
  } else if (user.role === 'industriel') {
    document.getElementById('pv-company').textContent = user.company_name || '—';
    document.getElementById('pv-sourcing-zone').textContent = user.sourcing_zone || '—';
    document.getElementById('pv-sourcing-notes').textContent = user.sourcing_notes || '—';
  }

  db.listAllPayments().then(({ data: payments }) => {
    const mine = payments.filter(p => p.user_id === user.id);
    const pending = mine.find(p => p.status === 'pending');
    const premiumEl = document.getElementById('pv-premium');
    if (user.is_premium) premiumEl.textContent = '⭐ Premium actif';
    else if (pending) premiumEl.textContent = '⏳ Paiement en attente de validation';
    else premiumEl.textContent = 'Compte gratuit';
  });

  exitEditMode();
}

function formatCMPhone(phone) {
  if (!phone) return '—';
  return phone.replace(/(\d{1})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4 $5');
}

function setSelectedChips(containerId, values) {
  const container = document.getElementById(containerId);
  container.querySelectorAll('.chip').forEach(chip => {
    chip.classList.toggle('selected', (values || []).includes(chip.dataset.value));
  });
}

function enterEditMode() {
  const user = db.getCurrentUser();
  if (!user) return;
  document.getElementById('edit-name').value = user.full_name;
  document.getElementById('edit-phone').value = formatCMPhone(user.phone);
  document.getElementById('edit-zone').value = user.zone;
  document.getElementById('edit-phone-status').textContent = '';

  ['producteur', 'acheteur', 'industriel'].forEach(r => {
    document.getElementById('edit-block-' + r).style.display = (user.role === r) ? 'block' : 'none';
  });

  if (user.role === 'producteur') {
    setSelectedChips('edit-varieties', user.varieties || []);
    setSelectedChips('edit-farmsize', user.farm_size_range ? [user.farm_size_range] : []);
    setSelectedChips('edit-interests', user.interests || []);
  } else if (user.role === 'acheteur') {
    setSelectedChips('edit-buyertype', user.buyer_type ? [user.buyer_type] : []);
    setSelectedChips('edit-products-wanted', user.products_wanted || []);
    setSelectedChips('edit-purchase-volume', user.purchase_volume ? [user.purchase_volume] : []);
  } else if (user.role === 'industriel') {
    document.getElementById('edit-company').value = user.company_name || '';
    document.getElementById('edit-sourcing-zone').value = user.sourcing_zone || '';
    document.getElementById('edit-sourcing-notes').value = user.sourcing_notes || '';
  }

  document.getElementById('profil-view').style.display = 'none';
  document.getElementById('profil-edit').style.display = 'block';
}

function exitEditMode() {
  document.getElementById('profil-view').style.display = 'block';
  document.getElementById('profil-edit').style.display = 'none';
}

function getMultiSelectedValues(containerId) {
  return Array.from(document.querySelectorAll('#' + containerId + ' .chip.selected')).map(c => c.dataset.value);
}

async function saveProfileEdits() {
  const user = db.getCurrentUser();
  if (!user) return;
  const name = document.getElementById('edit-name').value.trim();
  const phoneRaw = document.getElementById('edit-phone').value.trim();
  const zone = normalizeZoneName(document.getElementById('edit-zone').value.trim());
  const statusEl = document.getElementById('edit-phone-status');

  if (!name || !zone) { showToast('Merci de remplir les champs requis'); return; }

  const normalizedPhone = normalizeCMPhone(phoneRaw);
  let phoneVerified = user.phone_verified;
  if (normalizedPhone !== user.phone) {
    if (!isValidCMPhone(phoneRaw)) {
      statusEl.textContent = '⚠️ Numéro invalide (format : 6XXXXXXXX)';
      statusEl.style.color = 'var(--terracotta)';
      return;
    }
    phoneVerified = false;
    showToast('Numéro modifié — vérification à refaire à la prochaine connexion');
  }

  const updates = { full_name: name, phone: normalizedPhone, phone_verified: phoneVerified, zone };

  if (user.role === 'producteur') {
    updates.varieties = getMultiSelectedValues('edit-varieties');
    updates.farm_size_range = getMultiSelectedValues('edit-farmsize')[0] || null;
    updates.interests = getMultiSelectedValues('edit-interests');
  } else if (user.role === 'acheteur') {
    updates.buyer_type = getMultiSelectedValues('edit-buyertype')[0] || null;
    updates.products_wanted = getMultiSelectedValues('edit-products-wanted');
    updates.purchase_volume = getMultiSelectedValues('edit-purchase-volume')[0] || null;
  } else if (user.role === 'industriel') {
    updates.company_name = document.getElementById('edit-company').value.trim();
    updates.sourcing_zone = normalizeZoneName(document.getElementById('edit-sourcing-zone').value.trim());
    updates.sourcing_notes = document.getElementById('edit-sourcing-notes').value.trim();
  }

  await db.updateProfile(user.id, updates);
  showToast('Profil mis à jour ✓');
  renderProfile();
}

// ---------- DÉMARRAGE ----------
// La page d'accueil est toujours le point d'entrée : on ne force
// jamais l'inscription au premier chargement (ça fait fuir les gens).
// L'inscription n'est déclenchée que par requireAuth(), au moment
// où la personne veut réellement publier quelque chose.
(function init() {
  showScreen('accueil');
  updateNotifBadge();
  updateProfileNavIcon();
})();
