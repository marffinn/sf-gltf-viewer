// script.js
import $ from 'jquery';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

let scene, camera, renderer, controls;
let directionalLight, ambientLight, pointLight1, pointLight2;
let currentModel = null;
let orbitRadius = 5; // Default radius
let pointLightsEnabled = true;
// Default to DoubleSide so models with inverted normals or single-layer
// surfaces don't appear inside-out / invisible from one direction.
let materialSide = THREE.DoubleSide;

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdddddd);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 5000);
    camera.position.z = 5;

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    document.getElementById('container').appendChild(renderer.domElement);

    // Load environment map for image-based lighting
    const exrLoader = new EXRLoader();
    exrLoader.load(
        './assets/env/venetian_crossroads_1k.exr',
        function (texture) {
            texture.mapping = THREE.EquirectangularReflectionMapping;
            const pmremGenerator = new THREE.PMREMGenerator(renderer);
            const envMap = pmremGenerator.fromEquirectangular(texture).texture;
            scene.environment = envMap;
            texture.dispose();
            pmremGenerator.dispose();
        },
        undefined,
        function (err) {
            console.warn('EXR env map failed to load — falling back to lights only.', err);
        }
    );

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.25;

    // r155+ uses physical light units; intensities are far higher than the legacy scale.
    directionalLight = new THREE.DirectionalLight(0xffffff, 3);
    directionalLight.position.set(1, 1, 1).normalize();
    scene.add(directionalLight);

    ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
    scene.add(ambientLight);

    pointLight1 = new THREE.PointLight(0xffffff, 50, 100);
    pointLight2 = new THREE.PointLight(0xffffff, 50, 100);
    scene.add(pointLight1, pointLight2);

    window.addEventListener('resize', onWindowResize, false);

    animate();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);

    if (pointLightsEnabled) {
        const time = performance.now() * 0.001;
        const center = controls.target;

        pointLight1.position.set(
            center.x + Math.sin(time * 0.5) * orbitRadius,
            center.y + Math.cos(time * 0.7) * orbitRadius * 0.5,
            center.z + Math.cos(time * 0.5) * orbitRadius
        );

        pointLight2.position.set(
            center.x + Math.sin(time * 0.7 + Math.PI / 3) * orbitRadius,
            center.y + Math.cos(time * 0.5 + Math.PI / 3) * orbitRadius * 0.5,
            center.z + Math.cos(time * 0.7 + Math.PI / 3) * orbitRadius
        );
    }

    controls.update();
    renderer.render(scene, camera);
}

function showLoading(show) {
    const el = document.getElementById('loadingIndicator');
    el.classList.toggle('hidden', !show);
}

function setProgress(percent) {
    document.getElementById('progressText').textContent = percent + '%';
    document.getElementById('progressBar').style.width = percent + '%';
}

function applyMaterialSide(model, side) {
    model.traverse(obj => {
        if (!obj.material) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m => {
            m.side = side;
            m.needsUpdate = true;
        });
    });
}

function disposeModel(model) {
    model.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach(m => {
                Object.values(m).forEach(v => {
                    if (v && v.isTexture) v.dispose();
                });
                m.dispose();
            });
        }
    });
}

function handleLoaded(gltf) {
    if (currentModel) {
        scene.remove(currentModel);
        disposeModel(currentModel);
        currentModel = null;
    }

    const model = gltf.scene;
    scene.add(model);
    currentModel = model;

    // Apply current material-side setting (defaults to DoubleSide so the
    // viewer doesn't render apparent backfaces on inverted / single-layer geometry).
    applyMaterialSide(model, materialSide);

    // Force matrices so the bounding box is correct.
    model.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();

    if (!isFinite(size) || size === 0) {
        console.warn('Model has zero/invalid bounding box — using defaults.', { box });
    }
    const fitSize = isFinite(size) && size > 0 ? size : 5;

    controls.target.copy(center);
    camera.position.set(center.x, center.y, center.z + fitSize * 1.5);
    camera.near = Math.max(fitSize / 1000, 0.001);
    camera.far = Math.max(fitSize * 100, 1000);
    camera.updateProjectionMatrix();
    orbitRadius = fitSize * 1.5;
    controls.update();

    console.info('Model loaded:', {
        center: center.toArray(),
        size,
        cameraPos: camera.position.toArray(),
    });

    showLoading(false);
}

function loadModel(url) {
    showLoading(true);
    setProgress(0);

    const loader = new GLTFLoader();
    loader.load(
        url,
        handleLoaded,
        function (xhr) {
            if (xhr.lengthComputable) {
                setProgress(Math.round((xhr.loaded / xhr.total) * 100));
            }
        },
        function (error) {
            console.error('Error loading GLB:', error);
            showLoading(false);
        }
    );
}

function loadFromFile(file) {
    if (!file) return;
    const name = file.name.toLowerCase();
    if (!name.endsWith('.glb') && !name.endsWith('.gltf')) {
        console.warn('Unsupported file type:', file.name);
        return;
    }

    showLoading(true);
    setProgress(0);

    const reader = new FileReader();
    reader.onprogress = function (e) {
        if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 50));
        }
    };
    reader.onload = function (e) {
        const loader = new GLTFLoader();
        try {
            loader.parse(
                e.target.result,
                '',
                function (gltf) {
                    setProgress(100);
                    handleLoaded(gltf);
                },
                function (error) {
                    console.error('Error parsing GLB:', error);
                    showLoading(false);
                }
            );
        } catch (err) {
            console.error('Error parsing GLB:', err);
            showLoading(false);
        }
    };
    reader.onerror = function () {
        console.error('Error reading file');
        showLoading(false);
    };

    if (name.endsWith('.gltf')) {
        reader.readAsText(file);
    } else {
        reader.readAsArrayBuffer(file);
    }
}

// Build a basename (lowercased) -> File map so loaders can resolve sibling
// resources like .mtl and texture images that were dropped together.
function buildFileMap(files) {
    const map = new Map();
    files.forEach(f => map.set(f.name.toLowerCase(), f));
    return map;
}

// Wire a LoadingManager so any URL that refers to one of the dropped files
// gets rewritten to a blob: URL pointing at that file's bytes.
function makeBlobManager(fileMap) {
    const manager = new THREE.LoadingManager();
    const blobUrls = [];
    manager.setURLModifier((url) => {
        const base = url.split(/[\\/]/).pop().toLowerCase();
        const file = fileMap.get(base);
        if (file) {
            const blobUrl = URL.createObjectURL(file);
            blobUrls.push(blobUrl);
            return blobUrl;
        }
        return url;
    });
    manager.dispose = () => blobUrls.forEach(URL.revokeObjectURL);
    return manager;
}

function loadObjBundle(objFile, fileMap) {
    showLoading(true);
    setProgress(0);

    const manager = makeBlobManager(fileMap);
    const mtlFile = Array.from(fileMap.values())
        .find(f => f.name.toLowerCase().endsWith('.mtl'));

    const finishWithObj = (objText, materials) => {
        try {
            const objLoader = new OBJLoader(manager);
            if (materials) {
                materials.preload();
                objLoader.setMaterials(materials);
            }
            const obj = objLoader.parse(objText);
            setProgress(100);
            handleLoaded({ scene: obj });
        } catch (err) {
            console.error('Error parsing OBJ:', err);
            showLoading(false);
        } finally {
            // Revoke blob URLs after a tick so async texture loads finish first.
            setTimeout(() => manager.dispose(), 5000);
        }
    };

    const readObjThen = (materials) => {
        const r = new FileReader();
        r.onprogress = (e) => {
            if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 80));
        };
        r.onload = (e) => finishWithObj(e.target.result, materials);
        r.onerror = () => { console.error('Failed to read OBJ'); showLoading(false); };
        r.readAsText(objFile);
    };

    if (mtlFile) {
        const r = new FileReader();
        r.onload = (e) => {
            try {
                const mtlLoader = new MTLLoader(manager);
                const materials = mtlLoader.parse(e.target.result, '');
                readObjThen(materials);
            } catch (err) {
                console.warn('MTL parse failed, loading OBJ without materials:', err);
                readObjThen(null);
            }
        };
        r.onerror = () => readObjThen(null);
        r.readAsText(mtlFile);
    } else {
        readObjThen(null);
    }
}

function loadFromFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    const objFile = files.find(f => f.name.toLowerCase().endsWith('.obj'));
    const gltfFile = files.find(f => /\.(glb|gltf)$/i.test(f.name));

    if (objFile) {
        loadObjBundle(objFile, buildFileMap(files));
    } else if (gltfFile) {
        loadFromFile(gltfFile);
    } else {
        console.warn('No supported model file found in drop. Expected .obj, .glb or .gltf.');
    }
}

function setupDragAndDrop() {
    const fileInput = document.getElementById('fileInput');
    const dropzone = document.getElementById('dropzone');
    const overlay = document.getElementById('dragOverlay');
    let dragDepth = 0;

    fileInput.addEventListener('change', function () {
        if (this.files && this.files.length) {
            loadFromFiles(this.files);
            this.value = '';
        }
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
        window.addEventListener(evt, preventDefaults, false);
    });

    window.addEventListener('dragenter', function () {
        dragDepth++;
        overlay.classList.remove('hidden');
        overlay.classList.add('flex');
    });

    window.addEventListener('dragleave', function () {
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) {
            overlay.classList.add('hidden');
            overlay.classList.remove('flex');
        }
    });

    window.addEventListener('drop', function (e) {
        dragDepth = 0;
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
        const files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length) loadFromFiles(files);
    });

    // Click on dropzone shouldn't double-trigger because the input covers it
    dropzone.addEventListener('click', function (e) {
        if (e.target === dropzone) fileInput.click();
    });
}

function makeSliderRow(label, { min, max, step, value }, onInput) {
    const row = document.createElement('div');
    row.className = 'flex flex-col gap-1';

    const header = document.createElement('div');
    header.className = 'flex items-center justify-between text-xs text-slate-300';
    const name = document.createElement('span');
    name.textContent = label;
    const val = document.createElement('span');
    val.className = 'font-mono text-slate-400 tabular-nums';
    val.textContent = Number(value).toFixed(2);
    header.append(name, val);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.className = 'w-full accent-indigo-500 h-1 cursor-pointer';
    input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        val.textContent = v.toFixed(2);
        onInput(v);
    });

    row.append(header, input);
    return row;
}

function makeToggleRow(label, value, onChange) {
    const row = document.createElement('label');
    row.className = 'flex items-center justify-between gap-3 text-xs text-slate-300 cursor-pointer';

    const name = document.createElement('span');
    name.textContent = label;

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!value;
    input.className = 'w-4 h-4 rounded accent-indigo-500 cursor-pointer';
    input.addEventListener('change', () => onChange(input.checked));

    row.append(name, input);
    return row;
}

function makeSelectRow(label, options, value, onChange) {
    const row = document.createElement('label');
    row.className = 'flex items-center justify-between gap-3 text-xs text-slate-300 cursor-pointer';

    const name = document.createElement('span');
    name.textContent = label;

    const select = document.createElement('select');
    select.className = 'bg-slate-800 border border-white/10 rounded px-2 py-1 text-xs text-slate-200 cursor-pointer focus:outline-none focus:border-indigo-400';
    options.forEach(opt => {
        const o = document.createElement('option');
        o.value = String(opt.value);
        o.textContent = opt.label;
        if (opt.value === value) o.selected = true;
        select.appendChild(o);
    });
    select.addEventListener('change', () => onChange(select.value));

    row.append(name, select);
    return row;
}

function buildLightControls() {
    const root = document.getElementById('light-controls');
    if (!root) return;

    root.append(
        makeSliderRow('Ambient', { min: 0, max: 5, step: 0.05, value: ambientLight.intensity },
            v => { ambientLight.intensity = v; }),
        makeSliderRow('Directional', { min: 0, max: 10, step: 0.1, value: directionalLight.intensity },
            v => { directionalLight.intensity = v; }),
        makeSliderRow('Point lights', { min: 0, max: 200, step: 1, value: pointLight1.intensity },
            v => { pointLight1.intensity = v; pointLight2.intensity = v; }),
        makeToggleRow('Animate point lights', pointLightsEnabled,
            v => { pointLightsEnabled = v; }),
        makeSliderRow('Environment', { min: 0, max: 5, step: 0.05, value: scene.environmentIntensity ?? 1 },
            v => { scene.environmentIntensity = v; }),
        makeSliderRow('Exposure', { min: 0, max: 3, step: 0.05, value: renderer.toneMappingExposure },
            v => { renderer.toneMappingExposure = v; }),
        makeSelectRow('Material side', [
            { value: THREE.DoubleSide, label: 'Double' },
            { value: THREE.FrontSide, label: 'Front' },
            { value: THREE.BackSide, label: 'Back' },
        ], materialSide, v => {
            materialSide = parseInt(v, 10);
            if (currentModel) applyMaterialSide(currentModel, materialSide);
        }),
    );
}

$(document).ready(function () {
    init();
    setupDragAndDrop();
    buildLightControls();

    $('#model-list a').click(function (e) {
        e.preventDefault();
        const url = $(this).attr('href');
        loadModel(url);
    });
});