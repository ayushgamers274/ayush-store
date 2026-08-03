(function () {
  'use strict';

  function safe(fn) { try { fn(); } catch (e) {} }
  var $ = function (s, p) { return (p || document).querySelector(s); };
  var $$ = function (s, p) { return Array.prototype.slice.call((p || document).querySelectorAll(s)); };
  var app = $('#app');

  var state = {
    user: null,
    settings: {},
    projects: [],
    owned: new Set(),
    myOrders: [],
    lastMsgId: 0,
    chatTimer: null,
    adminTimer: null,
    filters: { q: '', type: 'all' },
    adminTab: 'dashboard'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtPrice(p) { return p > 0 ? '₹' + Number(p).toLocaleString('en-IN') : 'Free'; }
  function fmtSize(b) {
    if (!b) return '';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
    return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }
  function fmtTime(t) {
    var d = new Date(String(t).replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  function fmtDate(t) {
    var d = new Date(String(t).replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return t;
    return d.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function api(path, opts) {
    opts = opts || {};
    var init = {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: {}
    };
    if (opts.body && !(opts.body instanceof FormData)) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    } else if (opts.body) {
      init.body = opts.body;
    }
    return fetch(path, init).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) throw new Error(data.error || 'Something went wrong');
        return data;
      });
    });
  }

  function toast(msg, type) {
    var t = document.createElement('div');
    t.className = 'toast ' + (type || '');
    t.textContent = msg;
    $('#toastWrap').appendChild(t);
    setTimeout(function () { t.remove(); }, 4000);
  }

  function openModal(html, cls) {
    var box = $('#modalBox');
    box.innerHTML = html;
    box.className = 'modal';
    if (cls) box.classList.add(cls);
    $('#modalOverlay').classList.add('show');
  }
  function closeModal() { $('#modalOverlay').classList.remove('show'); }
  function showModal(icon, title, text, actions) {
    var icons = {
      ok: '<svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>',
      info: '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path stroke-linecap="round" d="M12 8h.01M12 12v4"></path></svg>',
      err: '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v5m0 3h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"></path></svg>'
    };
    var btns = (actions || []).map(function (a) {
      return '<button class="btn ' + a.cls + '" data-m-action="' + a.id + '">' + esc(a.label) + '</button>';
    }).join('');
    openModal(
      '<div class="modal-icon ' + icon + '">' + icons[icon] + '</div>' +
      '<h3>' + esc(title) + '</h3>' +
      '<p>' + text + '</p>' +
      (btns ? '<div class="btn-row">' + btns + '</div>' : '')
    );
    $$('[data-m-action]', $('#modalBox')).forEach(function (b) {
      b.addEventListener('click', function () {
        var a = actions.filter(function (x) { return x.id === b.getAttribute('data-m-action'); })[0];
        if (a && a.onClick) { closeModal(); a.onClick(); }
        else closeModal();
      });
    });
  }

  /* ---------- theme ---------- */

  safe(function () {
    var saved = null;
    try { saved = localStorage.getItem('theme'); } catch (e) {}
    document.documentElement.setAttribute('data-theme', saved === 'light' ? 'light' : 'dark');
  });
  safe(function () {
    $('#themeToggle').addEventListener('click', function () {
      var html = document.documentElement;
      var next = html.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      html.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) {}
    });
  });

  /* ---------- cursor + progress ---------- */

  safe(function () {
    if (!window.matchMedia('(pointer: fine)').matches) return;
    var dot = $('#cursorDot'), ring = $('#cursorRing');
    var mx = -100, my = -100, rx = -100, ry = -100;
    document.addEventListener('mousemove', function (e) {
      mx = e.clientX; my = e.clientY;
      dot.style.transform = 'translate(' + (mx - 3) + 'px,' + (my - 3) + 'px)';
      var t = e.target.closest('a, button, input, textarea, select, .card, .fchip');
      ring.classList.toggle('grow', !!t);
    });
    (function loop() {
      rx += (mx - rx) * 0.14; ry += (my - ry) * 0.14;
      ring.style.left = rx + 'px'; ring.style.top = ry + 'px';
      requestAnimationFrame(loop);
    })();
    document.addEventListener('click', function (e) {
      var r = document.createElement('span');
      r.className = 'ripple';
      r.style.left = e.clientX + 'px';
      r.style.top = e.clientY + 'px';
      document.body.appendChild(r);
      setTimeout(function () { r.remove(); }, 600);
    });
  });

  safe(function () {
    var bar = $('#progress');
    function upd() {
      var h = document.documentElement;
      var t = (h.scrollTop || document.body.scrollTop);
      var tot = (h.scrollHeight - h.clientHeight) || 1;
      bar.style.width = (t / tot * 100) + '%';
    }
    window.addEventListener('scroll', upd, { passive: true });
    upd();
  });

  /* ---------- nav + mobile ---------- */

  function renderNav() {
    var links = '<a href="#/" class="nav-link" data-nav="/">Home</a>' +
      '<a href="#/store" class="nav-link" data-nav="/store">Store</a>';
    $('#navLinks').innerHTML = links;
    var auth = '';
    if (state.user) {
      auth += '<a href="#/account" class="chip-link" data-nav="/account">My account</a>';
      if (state.user.role === 'admin') {
        auth += '<a href="#/admin" class="chip-link" data-nav="/admin">Admin</a>';
      }
      auth += '<button class="chip-link" data-action="logout">Logout</button>';
    } else {
      auth += '<a href="#/login" class="chip-link" data-nav="/login">Login</a>' +
        '<a href="#/register" class="chip-link" data-nav="/register">Sign up</a>';
    }
    $('#navAuth').innerHTML = auth;
    var m = '<a href="#/">Home</a><a href="#/store">Store</a>';
    if (state.user) {
      m += '<a href="#/account">My account</a>';
      if (state.user.role === 'admin') m += '<a href="#/admin">Admin</a>';
      m += '<a href="#" data-action="logout">Logout</a>';
    }
    else m += '<a href="#/login">Login</a><a href="#/register">Sign up</a>';
    $('#mobileMenu').innerHTML = m;
    $('#footerName').textContent = state.settings.site_name || 'Ayush';
  }

  safe(function () {
    var h = $('#hamburger'), mm = $('#mobileMenu');
    h.addEventListener('click', function () {
      var open = mm.classList.toggle('show');
      h.classList.toggle('open', open);
    });
  });

  /* ---------- router ---------- */

  var routes = { '/': 'home', '/store': 'store', '/login': 'login', '/register': 'register', '/admin': 'admin', '/account': 'account' };
  function parseHash() {
    var h = location.hash.replace(/^#/, '') || '/';
    var parts = h.split('/').filter(Boolean);
    if (parts[0] === 'project' && parts[1]) return { name: 'project', id: decodeURIComponent(parts[1]) };
    var name = routes[h] ? routes[h] : (routes['/' + parts[0]] || 'home');
    return { name: name };
  }

  function render() {
    closeModal();
    var route = parseHash();
    var view = {
      home: viewHome,
      store: viewStore,
      project: function () { return viewProject(route.id); },
      login: viewLogin,
      register: viewRegister,
      admin: viewAdmin,
      account: viewAccount
    }[route.name];
    app.innerHTML = view ? view() : viewHome();
    renderNav();
    setActiveNav();
    initReveals();
    initTilt();
    if (route.name === 'home') startTypewriter();
    if (route.name === 'admin') loadAdminTab();
    if (route.name === 'account') loadAccount();
    window.scrollTo(0, 0);
    document.title = (state.settings.site_name || 'Ayush') + ' | ' + (route.name === 'home' ? 'Projects' : route.name[0].toUpperCase() + route.name.slice(1));
  }

  function setActiveNav() {
    var r = parseHash();
    var path = '/' + (r.name === 'home' ? '' : r.name === 'project' ? 'store' : r.name);
    $$('[data-nav]').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-nav') === path);
    });
  }

  window.addEventListener('hashchange', render);

  /* ---------- reveal + tilt ---------- */

  function initReveals() {
    safe(function () {
      if (!('IntersectionObserver' in window)) {
        $$('.reveal').forEach(function (el) { el.classList.add('visible'); });
        return;
      }
      var els = $$('.reveal');
      if (!els.length) return;
      var obs = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add('visible'); obs.unobserve(en.target); }
        });
      }, { threshold: 0.08 });
      els.forEach(function (el) { obs.observe(el); });
      setTimeout(function () {
        $$('.reveal:not(.visible)').forEach(function (el) {
          if (el.getBoundingClientRect().top < window.innerHeight) el.classList.add('visible');
        });
      }, 600);
    });
  }

  function initTilt() {
    if (window.matchMedia('(pointer: coarse)').matches) return;
    $$('[data-tilt]').forEach(function (card) {
      card.addEventListener('mousemove', function (e) {
        var r = card.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        card.style.transform = 'perspective(900px) rotateX(' + ((0.5 - py) * 6) + 'deg) rotateY(' + ((px - 0.5) * 6) + 'deg)';
        card.style.setProperty('--mx', (px * 100) + '%');
        card.style.setProperty('--my', (py * 100) + '%');
      });
      card.addEventListener('mouseleave', function () { card.style.transform = ''; });
    });
  }

  /* ---------- data ---------- */

  function loadData() {
    return Promise.all([
      api('/api/settings'),
      api('/api/projects'),
      api('/api/me')
    ]).then(function (r) {
      state.settings = r[0];
      state.projects = r[1];
      state.user = r[2].user;
      if (state.user) return refreshOrders();
    }).catch(function () {});
  }

  function refreshOwned() {
    if (!state.user) return Promise.resolve();
    return refreshOrders();
  }

  function pendingFor(projectId) {
    for (var i = 0; i < state.myOrders.length; i++) {
      var o = state.myOrders[i];
      if (String(o.project_id) === String(projectId) && (o.status === 'verify' || o.status === 'created')) return o;
    }
    return null;
  }

  function projectById(id) {
    for (var i = 0; i < state.projects.length; i++) if (String(state.projects[i].id) === String(id)) return state.projects[i];
    return null;
  }

  /* ---------- social icons ---------- */

  var SOCIAL_SVG = {
    github: '<svg fill="currentColor" viewBox="0 0 24 24"><path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.2.8-.5v-2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.4-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0C17.3 4.9 18.3 5.2 18.3 5.2c.6 1.6.2 2.8.1 3.1.7.8 1.2 1.8 1.2 3.1 0 4.5-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.6.8.5A11.5 11.5 0 0 0 23.5 12C23.5 5.7 18.3.5 12 .5z"/></svg>',
    linkedin: '<svg fill="currentColor" viewBox="0 0 24 24"><path d="M20.4 20.4h-3.5v-5.6c0-1.3 0-3-1.9-3s-2.1 1.4-2.1 2.9v5.7H9.4V9h3.4v1.6h.1c.5-.9 1.6-1.9 3.4-1.9 3.6 0 4.2 2.4 4.2 5.4v6.3zM5.3 7.4a2 2 0 1 1 0-4.1 2 2 0 0 1 0 4.1zM7.1 20.4H3.6V9h3.5v11.4z"/></svg>',
    x: '<svg fill="currentColor" viewBox="0 0 24 24"><path d="M18.9 2H22l-7 8 8.2 12h-6.4l-5-6.4L6 22H2.9l7.4-8.5L2.5 2H9l4.5 5.9L18.9 2zm-1.1 18h1.7L7.2 3.7H5.4L17.8 20z"/></svg>',
    instagram: '<svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5"></rect><circle cx="12" cy="12" r="4"></circle><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"></circle></svg>'
  };

  function socialLinks() {
    var s = state.settings, out = '';
    var map = [['github', s.github], ['linkedin', s.linkedin], ['x', s.x], ['instagram', s.instagram]];
    map.forEach(function (m) {
      if (m[1] && m[1].length > 1 && m[1] !== '#') {
        out += '<a class="social-link" href="' + esc(m[1]) + '" target="_blank" rel="noopener" aria-label="' + m[0] + '">' + SOCIAL_SVG[m[0]] + '</a>';
      }
    });
    return out;
  }

  /* ---------- card markup ---------- */

  function tagColor(t) {
    var colors = ['v', 'c', 'g', 'r'];
    var h = 0;
    for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % colors.length;
    return 'p-tag-' + colors[h];
  }

  function projectTags(p) {
    return (p.tags || []).map(function (t) {
      return '<span class="p-tag ' + tagColor(t) + '">' + esc(t) + '</span>';
    }).join('');
  }

  function projectButtons(p) {
    var owned = state.user && state.owned.has(p.id);
    var pending = state.user ? pendingFor(p.id) : null;
    var out = '';
    if (pending) {
      out += '<span class="btn btn-sm btn-outline" style="pointer-events:none;opacity:.8">Payment under review</span>';
    } else if (p.price > 0) {
      if (owned) {
        out += '<button class="btn btn-green btn-sm" data-action="download" data-id="' + p.id + '">Download</button>';
      } else {
        out += '<button class="btn btn-primary btn-sm" data-action="buy" data-id="' + p.id + '">Buy ' + fmtPrice(p.price) + '</button>';
      }
    } else {
      out += '<button class="btn btn-green btn-sm" data-action="download" data-id="' + p.id + '">Download</button>';
    }
    return out;
  }

  function projectCard(p, cls) {
    var owned = state.user && state.owned.has(p.id);
    return '<a class="card reveal' + (cls ? ' ' + cls : '') + '" href="#/project/' + p.id + '" data-tilt>' +
      '<div class="card-meta">' +
        '<span class="project-num">#' + String(p.id).padStart(2, '0') + ' · ' + esc(p.category) + '</span>' +
        '<span class="price-badge ' + (p.price > 0 ? 'price-paid' : 'price-free') + '">' + fmtPrice(p.price) + '</span>' +
      '</div>' +
      '<h3 class="project-name">' + esc(p.title) + '</h3>' +
      '<p class="project-desc">' + esc(p.description) + '</p>' +
      '<div class="project-tags">' + projectTags(p) + '</div>' +
      '<div class="card-actions">' +
        projectButtons(p) +
        '<span class="card-dl">' + p.downloads + ' downloads' + (p.size ? ' · ' + fmtSize(p.size) : '') + '</span>' +
        (owned && p.price > 0 ? '<span class="card-dl">✓ owned</span>' : '') +
      '</div>' +
    '</a>';
  }

  /* ---------- views ---------- */

  function typewriterMarkup() {
    var words = state.settings.hero_words || [];
    return '<span class="typed">' + (words[0] || '') + '</span><span class="type-cursor">|</span>';
  }

  function viewHome() {
    var s = state.settings;
    var featured = state.projects.filter(function (p) {
      return state.filters.type === 'all' || (state.filters.type === 'free' ? p.price === 0 : p.price > 0);
    });
    var freeCount = state.projects.filter(function (p) { return p.price === 0; }).length;
    var paidCount = state.projects.length - freeCount;
    return '' +
    '<section class="hero" id="home">' +
      '<div class="hero-grid"></div>' +
      '<div class="container hero-inner">' +
        '<div>' +
          '<p class="hero-eyebrow reveal">Welcome to my corner</p>' +
          '<h1 class="hero-name reveal reveal-scale" style="--d:.1s">' + esc(s.site_name) + '</h1>' +
          '<p class="hero-type reveal" style="--d:.2s">' + typewriterMarkup() + '</p>' +
          '<p class="hero-desc reveal" style="--d:.3s">' + esc(s.bio || '') + '</p>' +
          '<div class="hero-cta reveal" style="--d:.4s">' +
            '<a href="#/store" class="btn btn-primary">Browse projects' +
              '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3"></path></svg>' +
            '</a>' +
            '<a href="mailto:' + esc(s.email || '') + '" class="btn btn-outline">Email me</a>' +
          '</div>' +
          '<div class="hero-socials reveal" style="--d:.5s">' + socialLinks() + '</div>' +
        '</div>' +
        '<div class="hero-visual reveal reveal-right" style="--d:.3s">' +
          '<div class="orbit-ring-2"></div><div class="orbit-ring"></div>' +
          '<div class="monogram">' + esc((s.site_name || 'A')[0].toUpperCase()) + '</div>' +
          '<div class="chip chip-1">&gt;_ <b>Discord Bots</b></div>' +
          '<div class="chip chip-2">&gt;_ <b>Node.js</b></div>' +
          '<div class="chip chip-3">&gt;_ <b>Python</b></div>' +
          '<div class="chip chip-4">&gt;_ <b>UPI</b></div>' +
        '</div>' +
      '</div>' +
    '</section>' +
    '<div class="marquee"><div class="marquee-track">' +
      ['Discord Bots', 'Node.js', 'Python', 'Bot Sources', 'Web Scrapers', 'APIs', 'Automation', 'Tools'].map(function (w) {
        return '<span>' + w + '<i>.</i></span>';
      }).join('') +
      ['Discord Bots', 'Node.js', 'Python', 'Bot Sources', 'Web Scrapers', 'APIs', 'Automation', 'Tools'].map(function (w) {
        return '<span>' + w + '<i>.</i></span>';
      }).join('') +
    '</div></div>' +
    '<section class="section">' +
      '<div class="container">' +
        '<div class="reveal">' +
          '<div class="section-tag">// store</div>' +
          '<h2 class="section-title">All <em>projects</em></h2>' +
          '<p class="section-sub">Free ones — log in and download. Paid ones — view freely, pay once via UPI to unlock the source code.</p>' +
        '</div>' +
        '<div class="toolbar reveal">' +
          '<div class="filter-chips">' +
            '<button class="fchip' + (state.filters.type === 'all' ? ' on' : '') + '" data-action="filter" data-type="all">All projects</button>' +
            '<button class="fchip' + (state.filters.type === 'free' ? ' on' : '') + '" data-action="filter" data-type="free">Free projects</button>' +
            '<button class="fchip' + (state.filters.type === 'paid' ? ' on' : '') + '" data-action="filter" data-type="paid">Paid projects</button>' +
          '</div>' +
        '</div>' +
        (featured.length
          ? '<div class="grid-3" style="margin-top:2.5rem">' + featured.map(function (p) { return projectCard(p); }).join('') + '</div>'
          : '<div class="empty-state reveal" style="margin-top:2.5rem"><h3>Nothing here</h3><p>No projects match this filter yet.</p></div>') +
        '<div style="text-align:center;margin-top:2.5rem">' +
          '<a href="#/store" class="btn btn-outline">View all projects</a>' +
        '</div>' +
        '<div class="grid-3" style="margin-top:5rem">' +
          '<div class="card reveal"><div class="stat-num" style="font-family:var(--font-display);font-weight:800;font-size:2.2rem;background:linear-gradient(135deg,var(--accent),var(--accent-2));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent">' + state.projects.length + '</div><p style="color:var(--muted);font-size:.8rem;margin-top:.3rem">projects uploaded</p></div>' +
          '<div class="card reveal reveal-d1" style="--d:.1s"><div class="stat-num" style="font-family:var(--font-display);font-weight:800;font-size:2.2rem;color:var(--green)">' + freeCount + '</div><p style="color:var(--muted);font-size:.8rem;margin-top:.3rem">free downloads</p></div>' +
          '<div class="card reveal reveal-d1" style="--d:.2s"><div class="stat-num" style="font-family:var(--font-display);font-weight:800;font-size:2.2rem;color:var(--text)">' + paidCount + '</div><p style="color:var(--muted);font-size:.8rem;margin-top:.3rem">premium projects</p></div>' +
        '</div>' +
      '</div>' +
    '</section>';
  }

  function viewStore() {
    var f = state.filters;
    var list = state.projects.filter(function (p) {
      var q = f.q.toLowerCase();
      var matchQ = !q || p.title.toLowerCase().indexOf(q) !== -1 || p.description.toLowerCase().indexOf(q) !== -1 || p.tags.join(' ').toLowerCase().indexOf(q) !== -1;
      var matchT = f.type === 'all' || (f.type === 'free' ? p.price === 0 : f.type === 'paid' ? p.price > 0 : (p.category || '').toLowerCase().indexOf(f.type) !== -1);
      return matchQ && matchT;
    });
    return '<section class="section" style="padding-top:8rem">' +
      '<div class="container">' +
        '<div class="reveal">' +
          '<div class="section-tag">// store</div>' +
          '<h2 class="section-title">All <em>projects</em></h2>' +
          '<p class="section-sub">' + state.projects.length + ' projects · ' + state.projects.filter(function (p) { return p.price === 0; }).length + ' free · free ones download after login, paid ones unlock after UPI payment.</p>' +
        '</div>' +
        '<div class="quick-picks reveal">' +
          '<button class="quick-card" data-action="filter" data-type="free">' +
            '<span class="quick-ic">' +
              '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>' +
            '</span>' +
            '<span class="quick-body"><b>Free projects</b><small>Log in and download instantly — ' + state.projects.filter(function (p) { return p.price === 0; }).length + ' available</small></span>' +
            '<span class="quick-arrow">→</span>' +
          '</button>' +
          '<button class="quick-card" data-action="filter" data-type="paid">' +
            '<span class="quick-ic">' +
              '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"></path></svg>' +
            '</span>' +
            '<span class="quick-body"><b>Premium projects</b><small>Pay once via UPI — full source code unlocked · ' + state.projects.filter(function (p) { return p.price > 0; }).length + ' available</small></span>' +
            '<span class="quick-arrow">→</span>' +
          '</button>' +
        '</div>' +
        '<div class="toolbar reveal">' +
          '<div class="search-box"><input id="storeSearch" placeholder="Search projects..." value="' + esc(f.q) + '" /></div>' +
          '<div class="filter-chips">' +
            '<button class="fchip' + (f.type === 'discord' ? ' on' : '') + '" data-action="filter" data-type="discord">Discord</button>' +
            '<button class="fchip' + (f.type === 'web' ? ' on' : '') + '" data-action="filter" data-type="web">Web / API</button>' +
            '<button class="fchip' + (f.type === 'script' ? ' on' : '') + '" data-action="filter" data-type="script">Scripts</button>' +
            '<button class="fchip' + (f.type === 'free' ? ' on' : '') + '" data-action="filter" data-type="free">Free projects</button>' +
            '<button class="fchip' + (f.type === 'paid' ? ' on' : '') + '" data-action="filter" data-type="paid">Paid projects</button>' +
          '</div>' +
        '</div>' +
        (list.length
          ? '<div class="grid-3" style="margin-top:2.5rem">' + list.map(function (p) { return projectCard(p); }).join('') + '</div>'
          : '<div class="empty-state reveal" style="margin-top:2.5rem"><h3>Nothing found</h3><p>Try a different search or filter.</p></div>') +
      '</div>' +
    '</section>';
  }

  function viewProject(id) {
    var p = projectById(id);
    if (!p) return '<div class="empty-state" style="padding-top:8rem"><h3>Project not found</h3><a class="btn btn-outline" href="#/store" style="margin-top:1rem">Back to store</a></div>';
    var owned = state.user && state.owned.has(p.id);
    var pending = state.user ? pendingFor(p.id) : null;
    var btn = '';
    if (pending) {
      btn = '<span class="btn" style="pointer-events:none;opacity:.8">Payment under review</span>';
    } else if (p.price > 0) {
      btn = owned
        ? '<button class="btn btn-green" data-action="download" data-id="' + p.id + '">Download now</button>'
        : '<button class="btn btn-primary" data-action="buy" data-id="' + p.id + '">Buy ' + fmtPrice(p.price) + '</button>';
    } else {
      btn = '<button class="btn btn-green" data-action="download" data-id="' + p.id + '">Download free</button>';
    }
    return '<div class="detail-wrap">' +
      '<div class="card detail-card reveal">' +
        '<span class="project-num">#' + String(p.id).padStart(2, '0') + ' · ' + esc(p.category) + '</span>' +
        '<h1 class="detail-title">' + esc(p.title) + '</h1>' +
        '<div class="project-tags">' + projectTags(p) + '</div>' +
        '<p class="detail-desc">' + esc(p.description) + '</p>' +
        '<div class="detail-info">' +
          '<span class="mini">' + fmtPrice(p.price) + '</span>' +
          (p.size ? '<span class="mini">' + fmtSize(p.size) + '</span>' : '') +
          '<span class="mini">' + p.downloads + ' downloads</span>' +
          '<span class="mini">added ' + fmtDate(p.created_at) + '</span>' +
          (owned && p.price > 0 ? '<span class="mini" style="color:var(--green)">✓ purchased</span>' : '') +
        '</div>' +
        '<div class="detail-actions">' + btn +
          (p.price > 0 && !owned ? '<span class="card-dl">Members-only download · pay via UPI once, download forever</span>' : '') +
        '</div>' +
      '</div>' +
      '<div style="text-align:center;margin-top:1.5rem"><a href="#/store" class="btn btn-outline btn-sm">← Back to store</a></div>' +
    '</div>';
  }

  function viewAccount() {
    if (!state.user) {
      return '<div class="empty-state" style="padding-top:8rem"><h3>Log in first</h3><p>Log in to see your purchases and downloads.</p><a class="btn btn-primary" href="#/login" style="margin-top:1rem">Go to login</a></div>';
    }
    return '<div class="auth-wrap" style="max-width:40rem">' +
      '<div class="reveal"><div class="section-tag">// my account</div>' +
      '<h2 class="section-title">Hi, <em>' + esc(state.user.name) + '</em></h2>' +
      '<p class="section-sub">' + esc(state.user.email) + ' — your purchases and order history.</p></div>' +
      '<div class="admin-panel" id="accountPanel"><div class="empty-state"><p>Loading...</p></div></div>' +
    '</div>';
  }

  function loadAccount() {
    api('/api/me/orders').then(function (rows) {
      var panel = $('#accountPanel');
      if (!panel) return;
      if (!rows.length) {
        panel.innerHTML = '<div class="empty-state"><h3>No purchases yet</h3><p>Browse the store — premium projects show up here after you buy them.</p><a class="btn btn-primary" href="#/store" style="margin-top:1rem">Browse store</a></div>';
        return;
      }
      panel.innerHTML = '<div class="admin-list">' + rows.map(function (o) {
        var owned = state.owned.has(parseInt(o.project_id, 10)) || o.status === 'paid';
        var statusHtml = '';
        if (o.status === 'paid') {
          statusHtml = '<span class="tag tag-green">Paid ✓</span>';
        } else if (o.status === 'verify') {
          statusHtml = '<span class="tag tag-violet" title="UTR: ' + esc(o.payment_id || '') + '">Payment submitted — awaiting Ayush\'s approval</span>';
        } else {
          statusHtml = '<span class="tag tag-red">' + esc(o.status) + '</span>';
        }
        return '<div class="admin-item">' +
          '<div class="grow"><h4>' + esc(o.title) + '</h4>' +
          '<p>' + (o.project_price > 0 ? fmtPrice(o.project_price) : 'Free') + ' · Order #' + o.id + ' · ' + fmtDate(o.created_at) + '</p></div>' +
          statusHtml +
          (owned ? '<button class="btn btn-green btn-sm" data-action="download" data-id="' + o.project_id + '">Download</button>' : '') +
        '</div>';
      }).join('') + '</div>';
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  function viewLogin() {
    return '<div class="auth-wrap"><div class="card auth-card reveal">' +
      '<h2>Welcome back</h2><p>Log in to download and buy projects.</p>' +
      '<div class="form-error" id="formError"></div>' +
      '<form id="loginForm" novalidate>' +
        '<div class="field"><label>Email</label><input name="email" type="email" placeholder="you@example.com" required /></div>' +
        '<div class="field"><label>Password</label><input name="password" type="password" placeholder="••••••••" required /></div>' +
        '<button class="btn btn-primary btn-block" style="margin-top:1.5rem" type="submit">Log in</button>' +
      '</form>' +
      '<p class="auth-alt">New here? <a href="#/register">Create an account</a></p>' +
    '</div></div>';
  }

  function viewRegister() {
    return '<div class="auth-wrap"><div class="card auth-card reveal">' +
      '<h2>Join as a member</h2><p>Create an account to download free projects and buy premium ones.</p>' +
      '<div class="form-error" id="formError"></div>' +
      '<form id="registerForm" novalidate>' +
        '<div class="field"><label>Name</label><input name="name" type="text" placeholder="Your name" required /></div>' +
        '<div class="field"><label>Email</label><input name="email" type="email" placeholder="you@example.com" required /></div>' +
        '<div class="field"><label>Password</label><input name="password" type="password" placeholder="Minimum 6 characters" required /><div class="hint">Minimum 6 characters</div></div>' +
        '<button class="btn btn-primary btn-block" style="margin-top:1.5rem" type="submit">Create account</button>' +
      '</form>' +
      '<p class="auth-alt">Already have an account? <a href="#/login">Log in</a></p>' +
    '</div></div>';
  }

  /* ---------- admin ---------- */

  function adminTabs() {
    var tabs = [['dashboard', 'Dashboard'], ['projects', 'Projects'], ['orders', 'Orders'], ['messages', 'Messages'], ['members', 'Members'], ['settings', 'Settings']];
    return '<div class="admin-tabs">' + tabs.map(function (t) {
      return '<button class="admin-tab' + (state.adminTab === t[0] ? ' on' : '') + '" data-action="admin-tab" data-tab="' + t[0] + '">' + t[1] + '</button>';
    }).join('') + '</div>';
  }

  function viewAdmin() {
    if (!state.user) {
      return '<div class="empty-state" style="padding-top:8rem"><h3>Admin only</h3><p>Log in with the admin account first.</p><a class="btn btn-primary" href="#/login" style="margin-top:1rem">Go to login</a></div>';
    }
    if (state.user.role !== 'admin') {
      return '<div class="empty-state" style="padding-top:8rem"><h3>Access denied</h3><p>This area is for the site owner.</p></div>';
    }
    return '<div class="admin-shell">' +
      '<div class="reveal"><div class="section-tag">// admin</div><h2 class="section-title">Control <em>panel</em></h2></div>' +
      adminTabs() +
      '<div class="admin-panel" id="adminPanel">' + adminPanelHtml() + '</div>' +
    '</div>';
  }

  function adminPanelHtml() {
    var t = state.adminTab;
    if (t === 'dashboard') return '<div class="admin-grid">' +
      '<div class="stat-box"><div class="stat-num" id="stProjects">–</div><div class="stat-label">projects</div></div>' +
      '<div class="stat-box"><div class="stat-num" id="stMembers">–</div><div class="stat-label">members</div></div>' +
      '<div class="stat-box"><div class="stat-num" id="stOrders">–</div><div class="stat-label">paid orders</div></div>' +
      '<div class="stat-box"><div class="stat-num" id="stRevenue">–</div><div class="stat-label">revenue</div></div>' +
    '</div>' +
    '<div class="card" style="margin-top:1rem;padding:1.2rem 1.5rem;display:flex;align-items:center;gap:1rem;flex-wrap:wrap">' +
      '<span class="tag" id="payModeTag">checking payments...</span>' +
      '<span style="color:var(--muted);font-size:.82rem" id="payModeText"></span>' +
      '<a href="#/admin" class="btn btn-outline btn-sm" data-action="admin-tab" data-tab="settings" style="margin-left:auto">Configure payments</a>' +
    '</div>' +
    '<div class="empty-state" style="padding:2rem"><p>Use the tabs above: upload projects, watch orders, answer chat messages, edit your profile details.</p></div>';
    if (t === 'projects') {
      return '<div class="grid-2">' +
        '<form class="card admin-form" id="uploadForm" enctype="multipart/form-data">' +
          '<h3 style="font-family:var(--font-display);font-weight:700;margin-bottom:1rem">Upload a project</h3>' +
          '<div class="field"><label>Title</label><input name="title" required maxlength="100" /></div>' +
          '<div class="field"><label>Description</label><textarea name="description" required maxlength="3000" placeholder="What does it do? What is included?"></textarea></div>' +
          '<div class="form-row-2">' +
            '<div class="field"><label>Price (₹) — 0 = free</label><input name="price" type="number" min="0" step="1" value="0" required /></div>' +
            '<div class="field"><label>Category</label><select name="category">' +
              '<option value="Discord Bot">Discord Bot</option>' +
              '<option value="Discord Bot Src">Discord Bot Src</option>' +
              '<option value="Discord Tool">Discord Tool</option>' +
              '<option value="Web / API">Web / API</option>' +
              '<option value="Python">Python</option>' +
              '<option value="Script">Script</option>' +
              '<option value="Other">Other</option>' +
            '</select></div>' +
          '</div>' +
          '<div class="field"><label>Tags (comma separated)</label><input name="tags" placeholder="react, node, api" maxlength="200" /></div>' +
          '<div class="file-drop">' +
            '<input type="file" name="file" required />' +
            '<b>Click to choose project file</b><br />Any file type, up to 100 MB. Members download this after access is unlocked.' +
          '</div>' +
          '<button class="btn btn-primary btn-block" style="margin-top:1.5rem" type="submit">Upload project</button>' +
        '</form>' +
        '<div><div class="admin-list" id="adminProjects">' + adminProjectsList() + '</div></div>' +
      '</div>';
    }
    if (t === 'orders') return '<div class="table-wrap"><table><thead><tr><th>ID</th><th>Project</th><th>Member</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead><tbody id="adminOrders"><tr><td colspan="6" style="text-align:center;color:var(--dim)">Loading...</td></tr></tbody></table></div>';
    if (t === 'messages') {
      return '<div class="grid-2">' +
        '<div class="card admin-form">' +
          '<h3 style="font-family:var(--font-display);font-weight:700;margin-bottom:.5rem">Chat inbox</h3>' +
          '<p style="color:var(--muted);font-size:.82rem;margin-bottom:1rem">Messages from visitors. Reply here — they see it in the chat widget.</p>' +
          '<div class="table-wrap" style="max-height:22rem;overflow:auto"><table><thead><tr><th>From</th><th>Message</th><th>Time</th></tr></thead><tbody id="adminMsgs"></tbody></table></div>' +
        '</div>' +
        '<div class="card admin-form">' +
          '<h3 style="font-family:var(--font-display);font-weight:700;margin-bottom:1rem">Reply</h3>' +
          '<div class="field"><label>Your reply</label><textarea id="adminReplyText" rows="6" maxlength="2000" placeholder="Type your reply here..."></textarea></div>' +
          '<button class="btn btn-primary" style="margin-top:1rem" data-action="admin-reply">Send reply</button>' +
        '</div>' +
      '</div>';
    }
    if (t === 'members') return '<div class="table-wrap"><table><thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Joined</th></tr></thead><tbody id="adminMembers"><tr><td colspan="4" style="text-align:center;color:var(--dim)">Loading...</td></tr></tbody></table></div>';
    if (t === 'settings') {
      var s = state.settings;
      var words = (s.hero_words || []).join(', ');
      return '<div class="grid-2">' +
      '<form class="card admin-form" id="settingsForm">' +
        '<h3 style="font-family:var(--font-display);font-weight:700;margin-bottom:1rem">Your profile details</h3>' +
        '<div class="form-row-2">' +
          '<div class="field"><label>Site name</label><input name="site_name" value="' + esc(s.site_name) + '" maxlength="60" /></div>' +
          '<div class="field"><label>Tagline</label><input name="tagline" value="' + esc(s.tagline) + '" maxlength="120" /></div>' +
        '</div>' +
        '<div class="field"><label>Bio (shown on home)</label><textarea name="bio" maxlength="3000">' + esc(s.bio) + '</textarea></div>' +
        '<div class="form-row-2">' +
          '<div class="field"><label>Email</label><input name="email" value="' + esc(s.email) + '" maxlength="120" /></div>' +
          '<div class="field"><label>Hero words (comma separated)</label><input name="hero_words" value="' + esc(words) + '" maxlength="200" /></div>' +
        '</div>' +
        '<div class="form-row-2">' +
          '<div class="field"><label>GitHub URL</label><input name="github" value="' + esc(s.github) + '" maxlength="300" /></div>' +
          '<div class="field"><label>LinkedIn URL</label><input name="linkedin" value="' + esc(s.linkedin) + '" maxlength="300" /></div>' +
        '</div>' +
        '<div class="form-row-2">' +
          '<div class="field"><label>X (Twitter) URL</label><input name="x" value="' + esc(s.x) + '" maxlength="300" /></div>' +
          '<div class="field"><label>Instagram URL</label><input name="instagram" value="' + esc(s.instagram) + '" maxlength="300" /></div>' +
        '</div>' +
        '<button class="btn btn-primary" style="margin-top:1.5rem" type="submit">Save settings</button>' +
      '</form>' +
      '<form class="card admin-form" id="payForm">' +
        '<h3 style="font-family:var(--font-display);font-weight:700;margin-bottom:.4rem">UPI payments (FamPay / GPay / PhonePe)</h3>' +
        '<p style="color:var(--muted);font-size:.82rem;line-height:1.6;margin-bottom:1rem">Members pay to your UPI ID from any UPI app, enter the transaction UTR, and you approve it in Orders to unlock their download. Find your UPI ID in the FamPay / Google Pay / PhonePe app.</p>' +
        '<div class="field"><label>Your UPI ID</label><input name="upi_id" placeholder="you@fam" maxlength="80" /></div>' +
        '<div class="field"><label>Name shown on QR</label><input name="upi_name" placeholder="Ayush" maxlength="60" /></div>' +
        '<button class="btn btn-primary" style="margin-top:1.5rem" type="submit">Save UPI details</button>' +
      '</form>' +
      '</div>';
    }
    return '';
  }

  function adminProjectsList() {
    if (!state.projects.length) return '<div class="empty-state"><p>No projects yet. Upload your first one.</p></div>';
    return state.projects.map(function (p) {
      return '<div class="admin-item">' +
        '<div class="grow"><h4>' + esc(p.title) + '</h4>' +
        '<p>' + fmtPrice(p.price) + ' · ' + p.downloads + ' downloads · ' + esc(p.category) + '</p></div>' +
        '<button class="btn btn-red btn-sm" data-action="del-project" data-id="' + p.id + '">Delete</button>' +
      '</div>';
    }).join('');
  }

  function loadAdminDashboard() {
    safe(function () {
      api('/api/admin/stats').then(function (st) {
        $('#stProjects').textContent = st.projects;
        $('#stMembers').textContent = st.members;
        $('#stOrders').textContent = st.orders;
        $('#stRevenue').textContent = '₹' + Number(st.revenue).toLocaleString('en-IN');
      }).catch(function () {});
    });
    safe(function () {
      api('/api/admin/payments/status').then(function (st) {
        var tag = $('#payModeTag'), text = $('#payModeText');
        if (!tag) return;
        if (st.configured) {
          tag.textContent = 'Payments: READY (' + st.upiId + ')';
          tag.className = 'tag tag-green';
          text.textContent = 'Members pay via UPI to your ID, you verify the UTR in your UPI app and approve the order.';
        } else {
          tag.textContent = 'Payments: UPI ID NOT SET';
          tag.className = 'tag tag-red';
          text.textContent = 'Add your UPI ID (FamPay / GPay / PhonePe) in Settings to start accepting payments.';
        }
      }).catch(function () {});
    });
  }

  function loadAdminSettings() {
    safe(function () {
      api('/api/admin/settings').then(function (s) {
        var form = $('#payForm');
        if (!form) return;
        form.elements.upi_id.value = s.upi_id || '';
        form.elements.upi_name.value = s.upi_name || '';
      }).catch(function () {});
    });
  }

  function loadAdminOrders() {
    api('/api/admin/orders').then(function (rows) {
      $('#adminOrders').innerHTML = rows.length ? rows.map(function (o) {
        var statusHtml = '';
        if (o.status === 'verify') {
          statusHtml = '<span class="tag tag-violet" title="UTR: ' + esc(o.payment_id || '') + '">verify — UTR: ' + esc(o.payment_id || '') + '</span>' +
            '<div style="margin-top:.4rem;white-space:nowrap">' +
              '<button class="btn btn-green btn-sm" data-action="approve" data-id="' + o.id + '">Approve</button> ' +
              '<button class="btn btn-outline btn-sm" data-action="reject" data-id="' + o.id + '">Reject</button>' +
            '</div>';
        } else if (o.status === 'paid') {
          statusHtml = '<span class="tag tag-green">paid ✓</span>';
        } else {
          statusHtml = '<span class="tag tag-red">' + esc(o.status) + '</span>';
        }
        return '<tr>' +
          '<td><b>#' + o.id + '</b></td>' +
          '<td><b>' + esc(o.project_title) + '</b></td>' +
          '<td>' + esc(o.user_name) + ' <br /><span style="font-size:.72rem">' + esc(o.user_email) + '</span></td>' +
          '<td><b>₹' + Number(o.amount).toLocaleString('en-IN') + '</b></td>' +
          '<td>' + statusHtml + '</td>' +
          '<td style="white-space:nowrap">' + fmtDate(o.created_at) + '</td>' +
        '</tr>';
      }).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--dim)">No orders yet</td></tr>';
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  function decideOrder(id, approve) {
    api('/api/orders/approve', { method: 'POST', body: { orderId: id, approve: approve } }).then(function () {
      toast(approve ? 'Order approved — buyer can download now' : 'Order rejected', approve ? 'ok' : '');
      loadAdminOrders();
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  function loadAdminMembers() {
    api('/api/admin/members').then(function (rows) {
      $('#adminMembers').innerHTML = rows.length ? rows.map(function (u) {
        return '<tr><td><b>#' + u.id + '</b></td><td><b>' + esc(u.name) + '</b></td><td>' + esc(u.email) + '</td><td style="white-space:nowrap">' + fmtDate(u.created_at) + '</td></tr>';
      }).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--dim)">No members yet</td></tr>';
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  function loadAdminMsgs() {
    return api('/api/messages').then(function (rows) {
      var el = $('#adminMsgs');
      if (!el) return;
      el.innerHTML = rows.length ? rows.slice().reverse().map(function (m) {
        var from = m.is_bot ? '<b>Bot (auto)</b>' : (m.role === 'admin' ? '<b>You</b>' : '<b>' + esc(m.name) + '</b>');
        return '<tr>' +
          '<td>' + from + '<br /><span style="font-size:.72rem">' + (m.is_bot ? 'bot' : m.role) + '</span></td>' +
          '<td>' + esc(m.text) + '</td>' +
          '<td style="white-space:nowrap">' + fmtTime(m.created_at) + '</td>' +
        '</tr>';
      }).join('') : '<tr><td colspan="3" style="text-align:center;color:var(--dim)">No messages yet</td></tr>';
    }).catch(function () {});
  }

  function loadAdminTab() {
    if (state.adminTab === 'dashboard') loadAdminDashboard();
    if (state.adminTab === 'orders') loadAdminOrders();
    if (state.adminTab === 'members') loadAdminMembers();
    if (state.adminTab === 'messages') loadAdminMsgs();
    if (state.adminTab === 'settings') loadAdminSettings();
  }

  /* ---------- payments (UPI) ---------- */

  function upiLink(o) {
    var params = 'pa=' + encodeURIComponent(o.upi.id) + '&pn=' + encodeURIComponent(o.upi.name || '') +
      '&am=' + encodeURIComponent(o.amount) + '&cu=INR&tn=' + encodeURIComponent('Order #' + o.orderId + ' - ' + o.projectTitle);
    return 'upi://pay?' + params;
  }

  function qrUrl(o) {
    return 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&qzone=1&data=' + encodeURIComponent(upiLink(o));
  }

  function buyProject(id) {
    if (!state.user) {
      toast('Log in to buy projects', 'err');
      location.hash = '#/login';
      return;
    }
    api('/api/orders', { method: 'POST', body: { projectId: id } }).then(function (o) {
      if (o.alreadyOwned) {
        toast('You already own this project', 'ok');
        return refreshOwned().then(render);
      }
      if (o.alreadyPending) {
        toast('You already have a pending payment for this project — check My Account', '');
        location.hash = '#/account';
        return;
      }
      openUpiModal(o);
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  function openUpiModal(o) {
    openModal(
      '<div class="modal-icon info">' +
        '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 9V7a5 5 0 0 0-10 0v2m-2 0h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z"></path></svg>' +
      '</div>' +
      '<h3>Pay ' + fmtPrice(o.amount) + '</h3>' +
      '<p>Buying <b>' + esc(o.projectTitle) + '</b>. Pay via <b>FamPay</b> or any UPI app to:</p>' +
      '<div style="margin:1rem auto;text-align:center">' +
        '<img src="' + qrUrl(o) + '" alt="UPI QR" style="width:11rem;height:11rem;border-radius:1rem;border:1px solid var(--border);background:#fff;padding:.5rem" onerror="this.style.display=\'none\'" />' +
        '<p style="font-family:var(--font-mono);font-size:1.1rem;font-weight:600;margin:.8rem 0 .2rem">' + esc(o.upi.id) + '</p>' +
        '<p style="font-size:.72rem;color:var(--dim)">Amount: ' + fmtPrice(o.amount) + ' · Order #' + o.orderId + '</p>' +
        '<a class="btn btn-primary" style="margin-top:.9rem" href="' + upiLink(o) + '" target="_blank" rel="noopener">Open UPI app</a>' +
      '</div>' +
      '<p style="font-size:.82rem;margin-top:1rem">After paying, enter the <b>12-digit UTR / transaction number</b> from the UPI app. Ayush checks it and approves — your download unlocks.</p>' +
      '<div class="field" style="text-align:left"><label>UTR / transaction number</label>' +
        '<input id="upiUtr" maxlength="80" placeholder="e.g. 301268197755" /></div>' +
      '<div class="btn-row">' +
        '<button class="btn btn-primary" data-m-action="pay">I have paid — submit</button>' +
        '<button class="btn btn-outline" data-m-action="cancel">Cancel</button>' +
      '</div>'
    );
    $('#modalBox').querySelector('[data-m-action="pay"]').addEventListener('click', function () {
      var utr = $('#upiUtr').value.trim();
      if (utr.length < 4) { toast('Enter your UTR / transaction number first', 'err'); return; }
      verifyOrder(o.orderId, utr);
    });
  }

  function verifyOrder(orderId, utr) {
    return api('/api/orders/verify', { method: 'POST', body: { orderId: orderId, utr: utr } }).then(function (d) {
      closeModal();
      if (d.status === 'paid') {
        toast('Payment verified — project unlocked!', 'ok');
        return refreshOrders().then(render);
      }
      toast('Payment submitted — Ayush will check the UTR and approve', 'ok');
      return refreshOrders().then(render);
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  function refreshOrders() {
    if (!state.user) return Promise.resolve();
    return api('/api/me/orders').then(function (rows) {
      state.myOrders = rows;
      state.owned = new Set(rows.filter(function (o) { return o.status === 'paid'; }).map(function (o) { return o.project_id; }));
    });
  }

  function downloadProject(id) {
    if (!state.user) {
      toast('Log in to download projects', 'err');
      location.hash = '#/login';
      return;
    }
    fetch('/api/download/' + id, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'Download failed'); });
      var cd = r.headers.get('Content-Disposition') || '';
      var m = cd.match(/filename="?([^";]+)"?/i);
      var name = m ? m[1] : ('project-' + id + '.zip');
      return r.blob().then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = decodeURIComponent(name);
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
        toast('Download started', 'ok');
        return refreshOwned().then(render);
      });
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  /* ---------- chat widget ---------- */

  function renderChat() {
    var body = $('#chatBody');
    if (!body) return;
    body.scrollTop = body.scrollHeight;
  }

  function appendMsg(m) {
    var body = $('#chatBody');
    if (!body) return;
    if (m.id <= state.lastMsgId) return;
    state.lastMsgId = m.id;
    var div = document.createElement('div');
    div.className = m.role === 'admin' ? 'msg msg-admin' : 'msg msg-user';
    div.innerHTML = '<span class="m-name">' + esc(m.is_bot ? 'Bot' : (m.role === 'admin' ? (state.settings.site_name || 'Ayush') : m.name)) + '</span>' +
      esc(m.text).replace(/\n/g, '<br />') +
      '<span class="m-time">' + fmtTime(m.created_at) + '</span>';
    body.appendChild(div);
    renderChat();
  }

  function openChat() {
    $('#chatPanel').classList.add('open');
    state.lastMsgId = 0;
    $('#chatBody').innerHTML = '<div class="msg-system">Chat with ' + esc(state.settings.site_name || 'Ayush') + ' — I reply instantly (auto bot) and Ayush jumps in too. Ask about projects, prices, payments, anything.</div>';
    var name = '';
    try { name = localStorage.getItem('chat_name') || ''; } catch (e) {}
    $('#chatName').value = name;
    if (state.chatTimer) clearInterval(state.chatTimer);
    state.chatTimer = setInterval(function () {
      api('/api/messages?after=' + state.lastMsgId).then(function (rows) {
        rows.forEach(appendMsg);
      }).catch(function () {});
    }, 3000);
    api('/api/messages?after=0').then(function (rows) {
      rows.forEach(appendMsg);
    }).catch(function () {});
    $('#chatText').focus();
  }

  function closeChat() {
    $('#chatPanel').classList.remove('open');
    if (state.chatTimer) { clearInterval(state.chatTimer); state.chatTimer = null; }
  }

  function sendChat() {
    var text = $('#chatText').value.trim();
    var name = $('#chatName').value.trim().slice(0, 40) || 'Guest';
    if (!text) return;
    try { localStorage.setItem('chat_name', name); } catch (e) {}
    $('#chatText').value = '';
    api('/api/messages', { method: 'POST', body: { name: name, text: text } }).then(function (m) {
      appendMsg(m);
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  safe(function () {
    $('#chatToggle').addEventListener('click', function () {
      if ($('#chatPanel').classList.contains('open')) closeChat();
      else openChat();
    });
    $('#chatClose').addEventListener('click', closeChat);
    $('#chatSend').addEventListener('click', sendChat);
    $('#chatText').addEventListener('keydown', function (e) { if (e.key === 'Enter') sendChat(); });
  });

  /* ---------- global events ---------- */

  safe(function () {
    document.addEventListener('click', function (e) {
      var el = e.target.closest('[data-action]');
      if (!el) return;
      var act = el.getAttribute('data-action');
      if (act === 'logout') {
        api('/api/logout', { method: 'POST' }).then(function () {
          state.user = null;
          state.owned = new Set();
          state.myOrders = [];
          state.lastMsgId = 0;
          closeChat();
          render();
          location.hash = '#/';
          toast('Logged out', 'ok');
        }).catch(function () {
          state.user = null;
          render();
          location.hash = '#/';
        });
      }
      if (act === 'buy') {
        e.preventDefault();
        e.stopPropagation();
        buyProject(el.getAttribute('data-id'));
      }
      if (act === 'download') {
        e.preventDefault();
        e.stopPropagation();
        downloadProject(el.getAttribute('data-id'));
      }
      if (act === 'filter') {
        state.filters.type = el.getAttribute('data-type');
        render();
      }
      if (act === 'admin-tab') {
        state.adminTab = el.getAttribute('data-tab');
        render();
        loadAdminTab();
      }
      if (act === 'admin-reply') {
        var text = $('#adminReplyText').value.trim();
        if (!text) return;
        api('/api/admin/messages', { method: 'POST', body: { text: text } }).then(function (m) {
          $('#adminReplyText').value = '';
          toast('Reply sent', 'ok');
          loadAdminMsgs();
        }).catch(function (e) { toast(e.message, 'err'); });
      }
      if (act === 'approve' || act === 'reject') {
        var oid = el.getAttribute('data-id');
        var approving = act === 'approve';
        showModal(approving ? 'info' : 'err', approving ? 'Approve payment?' : 'Reject payment?',
          approving ? 'Mark this order as paid? The buyer will instantly get download access.' : 'Reject this order and delete the submitted UTR? The buyer won\'t get access.', [
          { id: 'yes', label: approving ? 'Approve' : 'Reject', cls: approving ? 'btn-green' : 'btn-red', onClick: function () { decideOrder(oid, approving); } },
          { id: 'no', label: 'Cancel', cls: 'btn-outline' }
        ]);
      }
      if (act === 'del-project') {
        var id = el.getAttribute('data-id');
        var p = projectById(id);
        showModal('err', 'Delete project?', 'This permanently deletes <b>' + esc(p ? p.title : '') + '</b> and its file.', [
          { id: 'yes', label: 'Delete', cls: 'btn-red', onClick: function () {
            api('/api/admin/projects/' + id, { method: 'DELETE' }).then(function () {
              toast('Project deleted', 'ok');
              return api('/api/projects').then(function (rows) { state.projects = rows; });
            }).then(render).catch(function (e) { toast(e.message, 'err'); });
          } },
          { id: 'no', label: 'Cancel', cls: 'btn-outline' }
        ]);
      }
    });

    document.addEventListener('submit', function (e) {
      var f = e.target;
      if (f.id === 'loginForm') {
        e.preventDefault();
        var errEl = $('#formError');
        errEl.classList.remove('show');
        api('/api/login', { method: 'POST', body: { email: f.email.value, password: f.password.value } }).then(function (d) {
          state.user = d.user;
          toast('Welcome back, ' + d.user.name + '!', 'ok');
          render();
          location.hash = '#/';
        }).catch(function (err) { errEl.textContent = err.message; errEl.classList.add('show'); });
      }
      if (f.id === 'registerForm') {
        e.preventDefault();
        var errEl2 = $('#formError');
        errEl2.classList.remove('show');
        api('/api/register', { method: 'POST', body: { name: f.name.value, email: f.email.value, password: f.password.value } }).then(function (d) {
          state.user = d.user;
          toast('Account created — welcome!', 'ok');
          render();
          location.hash = '#/';
        }).catch(function (err) { errEl2.textContent = err.message; errEl2.classList.add('show'); });
      }
      if (f.id === 'uploadForm') {
        e.preventDefault();
        var btn = f.querySelector('button[type=submit]');
        var old = btn.innerHTML;
        btn.disabled = true;
        btn.textContent = 'Uploading...';
        api('/api/admin/projects', { method: 'POST', body: new FormData(f) }).then(function () {
          toast('Project uploaded!', 'ok');
          return api('/api/projects').then(function (rows) { state.projects = rows; });
        }).then(function () {
          $('#adminProjects').innerHTML = adminProjectsList();
          f.reset();
        }).catch(function (err) { toast(err.message, 'err'); })
        .then(function () { btn.disabled = false; btn.innerHTML = old; });
      }
      if (f.id === 'settingsForm') {
        e.preventDefault();
        var data = {
          site_name: f.site_name.value,
          tagline: f.tagline.value,
          bio: f.bio.value,
          email: f.email.value,
          github: f.github.value,
          linkedin: f.linkedin.value,
          x: f.x.value,
          instagram: f.instagram.value,
          hero_words: f.hero_words.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean)
        };
        api('/api/admin/settings', { method: 'PUT', body: data }).then(function () {
          toast('Settings saved', 'ok');
          return api('/api/settings').then(function (s) { state.settings = s; });
        }).then(function () { renderNav(); }).catch(function (e) { toast(e.message, 'err'); });
      }
      if (f.id === 'payForm') {
        e.preventDefault();
        var pdata = {
          upi_id: f.upi_id.value.trim(),
          upi_name: f.upi_name.value.trim()
        };
        api('/api/admin/settings', { method: 'PUT', body: pdata }).then(function () {
          toast('UPI details saved — payments ready', 'ok');
        }).catch(function (e) { toast(e.message, 'err'); });
      }
    });

    document.addEventListener('input', function (e) {
      if (e.target.id === 'storeSearch') {
        clearTimeout(e.target._t);
        e.target._t = setTimeout(function () {
          state.filters.q = e.target.value;
          var list = state.projects.filter(function (p) {
            var q = state.filters.q.toLowerCase();
            if (!q) return true;
            return p.title.toLowerCase().indexOf(q) !== -1 || p.description.toLowerCase().indexOf(q) !== -1 || p.tags.join(' ').toLowerCase().indexOf(q) !== -1;
          });
          var grid = $('#app').querySelector('.grid-3');
          if (!grid) return;
          grid.innerHTML = list.length ? list.map(function (p) { return projectCard(p); }).join('') : '<div class="empty-state" style="grid-column:1/-1"><h3>Nothing found</h3></div>';
          initReveals();
        }, 250);
      }
    });

    $('#modalOverlay').addEventListener('click', function (e) {
      if (e.target === this) closeModal();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

    window.addEventListener('load', function () {
      if (state.adminTimer) clearInterval(state.adminTimer);
      state.adminTimer = setInterval(function () {
        if (state.user && state.user.role === 'admin' && parseHash().name === 'admin' && state.adminTab === 'messages') loadAdminMsgs();
      }, 4000);
    });
  });

  /* ---------- typewriter ---------- */

  var twTimer = null;
  function startTypewriter() {
    var el = $('#app').querySelector('.typed');
    if (!el) return;
    var words = state.settings.hero_words || [];
    if (!words.length) { el.textContent = ''; return; }
    if (twTimer) clearTimeout(twTimer);
    var wi = 0, ci = 0, deleting = false;
    el.textContent = '';
    function tick() {
      var word = words[wi];
      el.textContent = word.slice(0, ci);
      if (!deleting && ci < word.length) { ci++; twTimer = setTimeout(tick, 65); }
      else if (!deleting) { deleting = true; twTimer = setTimeout(tick, 1700); }
      else if (ci > 0) { ci--; twTimer = setTimeout(tick, 35); }
      else { deleting = false; wi = (wi + 1) % words.length; twTimer = setTimeout(tick, 400); }
    }
    tick();
  }

  /* ---------- boot ---------- */

  document.getElementById('year').textContent = new Date().getFullYear();

  loadData().then(function () {
    render();
    renderNav();
  }).catch(function () {
    render();
  });
})();
