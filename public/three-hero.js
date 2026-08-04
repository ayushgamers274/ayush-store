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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2));
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  container.appendChild(renderer.domElement);

  var count = isMobile ? 420 : 950;
  var positions = new Float32Array(count * 3);
  for (var i = 0; i < count; i++) {
    var r = 9 + Math.random() * 15;
    var theta = Math.random() * Math.PI * 2;
    var phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.7;
    positions[i * 3 + 2] = r * Math.cos(phi);
  }
  var stars = new THREE.BufferGeometry();
  stars.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  var starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.09, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
  var starField = new THREE.Points(stars, starMat);
  scene.add(starField);

  var knot = new THREE.Mesh(
    new THREE.TorusKnotGeometry(2.1, 0.55, isMobile ? 80 : 140, 16),
    new THREE.MeshPhongMaterial({ wireframe: true, transparent: true, opacity: 0.35 })
  );
  knot.position.z = -6;
  scene.add(knot);

  var shards = [];
  var shardGeo = new THREE.OctahedronGeometry(0.28, 0);
  for (var j = 0; j < 8; j++) {
    var m = new THREE.Mesh(shardGeo, new THREE.MeshPhongMaterial({ emissiveIntensity: 0.3, transparent: true, opacity: 0.85 }));
    m.position.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 7, (Math.random() - 0.5) * 8 - 2);
    m.userData.r = Math.random() * Math.PI * 2;
    scene.add(m);
    shards.push(m);
  }

  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  var pl = new THREE.PointLight(0x4cc9f0, 1.4, 40);
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
    starMat.color.setHex(light ? 0x8a94b8 : 0xffffff);
    knot.material.color.setHex(accent);
    knot.material.emissive.setHex(accent);
    knot.material.emissiveIntensity = 0.15;
    shards.forEach(function (m, k) {
      m.material.color.setHex(k % 2 ? accent2 : accent);
      m.material.emissive.setHex(k % 2 ? accent2 : accent);
    });
    pl.color.setHex(accent);
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
    knot.rotation.x = t * 0.6;
    knot.rotation.y = t;
    starField.rotation.y = t * 0.15;
    shards.forEach(function (m) {
      m.rotation.x += 0.01;
      m.rotation.y += 0.015;
      m.position.y += Math.sin(t * 2 + m.userData.r) * 0.004;
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
