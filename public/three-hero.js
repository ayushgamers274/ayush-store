(function () {
  if (!window.THREE) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var container = document.getElementById('scene3d');
  if (!container) return;
  var isMobile = window.matchMedia('(pointer: coarse)').matches;
  var cssVar = function (n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#4cc9f0'; };
  var hex = function (n) { return parseInt(n.replace('#', ''), 16); };

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.z = 14;
  var renderer = new THREE.WebGLRenderer({ alpha: true, antialias: !isMobile });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.25 : 1.75));
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  container.appendChild(renderer.domElement);

  function glowTexture(color1, color2) {
    var c = document.createElement('canvas');
    c.width = c.height = 256;
    var g = c.getContext('2d');
    var gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, color1);
    gr.addColorStop(0.35, color2);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  }

  var core = new THREE.Group();
  core.position.z = -6;
  scene.add(core);

  var coreTex = null, ringTex = null;
  function buildCore(accentHex, accent2Hex) {
    if (coreTex) { coreTex.dispose(); ringTex.dispose(); }
    coreTex = glowTexture('#' + ('00000' + accentHex.toString(16)).slice(-6), 'rgba(120,180,255,0.25)');
    ringTex = glowTexture('#ffffff', 'rgba(160,140,255,0.18)');
    var s1 = new THREE.Sprite(new THREE.SpriteMaterial({ map: coreTex, color: accentHex, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    s1.scale.set(5.4, 5.4, 1);
    var s2 = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, color: accent2Hex, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    s2.scale.set(8.5, 8.5, 1);
    core.add(s1);
    core.add(s2);
  }

  var ring = new THREE.Mesh(
    new THREE.RingGeometry(2.7, 2.72, 90),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  ring.rotation.x = Math.PI / 2.35;
  core.add(ring);

  var orbiters = [];
  var orbMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
  for (var oi = 0; oi < 6; oi++) {
    var orb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), orbMat);
    orb.userData.angle = (oi / 6) * Math.PI * 2;
    orb.userData.speed = 0.4 + Math.random() * 0.35;
    orb.userData.radius = 2.9 + Math.random() * 0.5;
    core.add(orb);
    orbiters.push(orb);
  }

  var count = isMobile ? 160 : 350;
  var positions = new Float32Array(count * 3);
  for (var i = 0; i < count; i++) {
    var r = 10 + Math.random() * 16;
    var theta = Math.random() * Math.PI * 2;
    var phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.7;
    positions[i * 3 + 2] = r * Math.cos(phi);
  }
  var stars = new THREE.BufferGeometry();
  stars.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  var starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.055, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
  var starField = new THREE.Points(stars, starMat);
  scene.add(starField);

  var shards = [];
  var shardGeo = new THREE.OctahedronGeometry(0.22, 0);
  for (var j = 0; j < 6; j++) {
    var m = new THREE.Mesh(shardGeo, new THREE.MeshPhongMaterial({ emissiveIntensity: 0.25, transparent: true, opacity: 0.7 }));
    m.position.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 10 - 1);
    m.userData.r = Math.random() * Math.PI * 2;
    scene.add(m);
    shards.push(m);
  }

  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  var pl = new THREE.PointLight(0x4cc9f0, 1, 40);
  pl.position.set(6, 4, 8);
  scene.add(pl);

  var mouseX = 0, mouseY = 0, tx = 0, ty = 0;
  window.addEventListener('mousemove', function (e) {
    mouseX = e.clientX / window.innerWidth - 0.5;
    mouseY = e.clientY / window.innerHeight - 0.5;
  }, { passive: true });

  function refreshColors() {
    var accent = hex(cssVar('--accent'));
    var accent2 = hex(cssVar('--accent-2'));
    var light = document.documentElement.getAttribute('data-theme') === 'light';
    starMat.color.setHex(light ? 0x7c87ad : 0xffffff);
    starMat.size = light ? 0.07 : 0.055;
    ring.material.color.setHex(accent);
    orbMat.color.setHex(accent2);
    pl.color.setHex(accent);
    while (core.children.length) core.remove(core.children[0]);
    buildCore(accent, accent2);
    core.add(ring);
    orbiters.forEach(function (o) { core.add(o); });
  }
  refreshColors();
  new MutationObserver(refreshColors).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  window.addEventListener('resize', function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  var t = 0, running = true;
  document.addEventListener('visibilitychange', function () { running = !document.hidden; });
  function tick() {
    if (!running) { requestAnimationFrame(tick); return; }
    t += 0.005;
    ring.rotation.z += 0.002;
    orbiters.forEach(function (o) {
      o.userData.angle += 0.008 * o.userData.speed;
      o.position.x = Math.cos(o.userData.angle) * o.userData.radius;
      o.position.y = Math.sin(o.userData.angle) * o.userData.radius * 0.35;
      o.position.z = Math.sin(o.userData.angle) * o.userData.radius * 0.9;
    });
    starField.rotation.y = t * 0.08;
    shards.forEach(function (m) {
      m.rotation.x += 0.008;
      m.rotation.y += 0.012;
      m.position.y += Math.sin(t * 1.6 + m.userData.r) * 0.003;
    });
    tx += (mouseX - tx) * 0.04;
    ty += (mouseY - ty) * 0.04;
    camera.position.x = tx * 2.2;
    camera.position.y = -ty * 1.6;
    camera.lookAt(0, 0, -4);
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  tick();
})();
