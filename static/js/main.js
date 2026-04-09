// --- 기본 설정 ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
const controls = new THREE.OrbitControls(camera, renderer.domElement);
document.getElementById('globe-container').appendChild(renderer.domElement);
renderer.setSize(window.innerWidth, window.innerHeight);
camera.position.z = 15;

// --- 조명 ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 3, 5);
scene.add(directionalLight);

// --- 지구본 생성 ---
const earthGeometry = new THREE.SphereGeometry(5, 32, 32);
const earthTexture = new THREE.TextureLoader().load('https://raw.githubusercontent.com/dataarts/webgl-globe/master/globe/world.jpg');
const earthMaterial = new THREE.MeshPhongMaterial({ map: earthTexture, specular: 0x333333, shininess: 15 });
const earth = new THREE.Mesh(earthGeometry, earthMaterial);
scene.add(earth);

// --- 전역 변수 ---
let allAirports = [];
let airportsData = {};
let airportGraph = {};
const MAX_DIRECT_DISTANCE_KM = 3000;
const EFFICIENCY_FACTOR = 0.7;
let currentMode = 'search';
let simulationRunning = false;
let airplanes = [];
let animationFrameId = null;
let simulationSpeed = 1.0;
let airplaneCount = 15;
let lastSimInsightTime = 0;
const SIM_INSIGHT_MS = 2800;

// --- 애니메이션 루프 ---
function animate() {
    animationFrameId = requestAnimationFrame(animate);
    controls.update();
    if (simulationRunning) {
        airplanes.forEach(plane => plane.update());
        maybeRefreshSimulationInsight();
    }
    renderer.render(scene, camera);
}

// --- 초기화 ---
function init() {
    setupEventListeners();
    setUiLoadingState(true, '데이터 로딩 중...');
    loadDataForStaticHosting()
        .then(() => {
            populateFilters();
            updateAirportSelects();
            setUiLoadingState(false);
        })
        .catch((error) => {
            console.error(error);
            setUiLoadingState(true, '데이터 로딩 실패 (CSV 파일 경로를 확인하세요)');
        });
    animate();
}

// --- 필터 및 선택 메뉴 채우기 ---
function populateFilters() {
    const continentSelect = document.getElementById('continent-filter');
    continentSelect.innerHTML = '';

    // 대륙 필터 채우기 (빈 continent 값 제외)
    const continents = ['All', ...new Set(allAirports.map(a => a.continent).filter(Boolean))].sort();
    continents.forEach(c => continentSelect.add(new Option(c, c)));

    updateCountryFilter(); // 국가 필터 초기화
}

function updateCountryFilter() {
    const continent = document.getElementById('continent-filter').value;
    const countrySelect = document.getElementById('country-filter');
    countrySelect.innerHTML = ''; // Clear previous options

    const filteredAirportsByContinent = (continent === 'All') ? allAirports : allAirports.filter(a => a.continent === continent);
    const countries = ['All', ...new Set(filteredAirportsByContinent.map(a => a.iso_country).filter(Boolean))].sort();
    countries.forEach(c => countrySelect.add(new Option(c, c)));

    updateAirportSelects(); // 공항 선택 메뉴 초기화
}

function updateAirportSelects() {
    const continentFilter = document.getElementById('continent-filter').value;
    const countryFilter = document.getElementById('country-filter').value;
    const originSearchText = document.getElementById('origin-search').value.toLowerCase();
    const destinationSearchText = document.getElementById('destination-search').value.toLowerCase();

    let filteredAirports = allAirports;

    if (continentFilter !== 'All') {
        filteredAirports = filteredAirports.filter(a => a.continent === continentFilter);
    }
    if (countryFilter !== 'All') {
        filteredAirports = filteredAirports.filter(a => a.iso_country === countryFilter);
    }

    const originSelect = document.getElementById('origin');
    const destinationSelect = document.getElementById('destination');
    originSelect.innerHTML = '';
    destinationSelect.innerHTML = '';

    const addOptions = (selectElement, searchText) => {
        const currentFiltered = filteredAirports.filter(airport => 
            airport.name.toLowerCase().includes(searchText) || 
            airport.iata_code.toLowerCase().includes(searchText)
        );
        currentFiltered.sort((a, b) => a.name.localeCompare(b.name));
        currentFiltered.forEach(airport => {
            const option = new Option(`${airport.name} (${airport.iata_code})`, airport.iata_code);
            selectElement.add(option);
        });
    };

    addOptions(originSelect, originSearchText);
    addOptions(destinationSelect, destinationSearchText);
}

// --- 이벤트 리스너 설정 ---
function setupEventListeners() {
    document.getElementById('continent-filter').addEventListener('change', updateCountryFilter);
    document.getElementById('country-filter').addEventListener('change', updateAirportSelects);

    // 데이터는 load 후에 채워지므로, 검색 시점의 allAirports를 써야 함 (초기 바인드하면 항상 [])
    document.getElementById('continent-search').addEventListener('input', () => {
        filterDropdownOptions('continent-filter', allAirports.map(a => a.continent).filter(Boolean));
    });
    document.getElementById('country-search').addEventListener('input', () => {
        const continent = document.getElementById('continent-filter').value;
        const filteredAirportsByContinent = (continent === 'All') ? allAirports : allAirports.filter(a => a.continent === continent);
        filterDropdownOptions('country-filter', filteredAirportsByContinent.map(a => a.iso_country).filter(Boolean));
    });
    document.getElementById('origin-search').addEventListener('input', updateAirportSelects);
    document.getElementById('destination-search').addEventListener('input', updateAirportSelects);

    document.getElementById('mode-search').addEventListener('click', (e) => {
        e.preventDefault();
        switchMode('search');
    });
    document.getElementById('mode-sim').addEventListener('click', (e) => {
        e.preventDefault();
        switchMode('sim');
    });
    document.getElementById('calculate').addEventListener('click', handleCalculateClick);
    document.getElementById('show-example').addEventListener('click', handleExampleClick);
    document.getElementById('toggle-sim').addEventListener('click', toggleSimulation);

    // 슬라이더 이벤트
    document.getElementById('airplane-count').addEventListener('input', (e) => {
        airplaneCount = parseInt(e.target.value);
        document.getElementById('airplane-count-label').textContent = airplaneCount;
        if (simulationRunning) restartSimulation();
    });
    document.getElementById('sim-speed').addEventListener('input', (e) => {
        simulationSpeed = parseFloat(e.target.value);
        document.getElementById('sim-speed-label').textContent = simulationSpeed.toFixed(1);
    });

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

function filterDropdownOptions(selectId, allPossibleOptions) {
    const searchInput = document.getElementById(selectId.replace('-filter', '-search'));
    const selectElement = document.getElementById(selectId);
    const searchText = searchInput.value.toLowerCase();
    const previousValue = selectElement.value;

    selectElement.innerHTML = '';
    const filteredOptions = ['All', ...new Set(allPossibleOptions.filter(Boolean))].sort().filter((option) =>
        String(option).toLowerCase().includes(searchText)
    );
    filteredOptions.forEach((option) => selectElement.add(new Option(option, option)));

    if (filteredOptions.includes(previousValue)) {
        selectElement.value = previousValue;
    } else {
        selectElement.value = 'All';
    }

    if (selectId === 'continent-filter') {
        updateCountryFilter();
    } else if (selectId === 'country-filter') {
        updateAirportSelects();
    }
}

// --- 모드 전환 ---
function switchMode(mode) {
    currentMode = mode;
    if (simulationRunning) toggleSimulation(); // 시뮬레이션 끄기
    clearScene();
    document.getElementById('results-panel').innerHTML = '';

    const explainEl = document.getElementById('explain-panel');
    const simInsightEl = document.getElementById('sim-insight-panel');

    if (mode === 'search') {
        document.getElementById('search-panel').style.display = 'block';
        document.getElementById('sim-controls').style.display = 'none';
        document.getElementById('mode-search').classList.add('active');
        document.getElementById('mode-sim').classList.remove('active');
        if (simInsightEl) {
            simInsightEl.style.display = 'none';
            simInsightEl.innerHTML = '';
        }
        if (explainEl) explainEl.style.display = 'none';
    } else {
        document.getElementById('search-panel').style.display = 'none';
        document.getElementById('sim-controls').style.display = 'block';
        document.getElementById('mode-search').classList.remove('active');
        document.getElementById('mode-sim').classList.add('active');
        if (explainEl) {
            explainEl.style.display = 'none';
            explainEl.innerHTML = '';
        }
        if (simInsightEl) {
            simInsightEl.style.display = 'block';
            simInsightEl.innerHTML =
                '<p class="small text-white-50 mb-0">시뮬레이션을 시작하면 약 3초마다 임의 항적을 골라, 같은 구간에 대해 <strong>그래프 최단 경로</strong> 기준 설명을 갱신합니다. (화면의 비행기는 시각용 직선 대권)</p>';
        }
    }
}

// --- 경로 계산 로직 ---
function handleCalculateClick() {
    const originIata = document.getElementById('origin').value;
    const destinationIata = document.getElementById('destination').value;
    calculateAndVisualize(originIata, destinationIata);
}

function handleExampleClick() {
    const airportIatas = Object.keys(airportsData);
    if (airportIatas.length < 2) return;

    let originIata, destinationIata;
    do {
        originIata = airportIatas[Math.floor(Math.random() * airportIatas.length)];
        destinationIata = airportIatas[Math.floor(Math.random() * airportIatas.length)];
    } while (originIata === destinationIata);

    // Reset filters and then set values
    document.getElementById('continent-filter').value = 'All';
    document.getElementById('continent-search').value = '';
    updateCountryFilter();
    document.getElementById('country-filter').value = 'All';
    document.getElementById('country-search').value = '';
    updateAirportSelects();
    
    document.getElementById('origin-search').value = '';
    document.getElementById('destination-search').value = '';

    // Set the values again after populating
    document.getElementById('origin').value = originIata;
    document.getElementById('destination').value = destinationIata;

    calculateAndVisualize(originIata, destinationIata);
}

function getAlgorithmMode() {
    const el = document.getElementById('algorithm-select');
    return el && el.value ? el.value : 'both';
}

function calculateAndVisualize(originIata, destinationIata) {
    if (!originIata || !destinationIata) return;
    const data = calculateRouteLocally(originIata, destinationIata);
    const algorithmMode = getAlgorithmMode();
    clearScene();
    const directPath = [originIata, destinationIata];
    visualizeArc(directPath, 0xffc107, 'direct');

    if (data.astar_path) {
        if (algorithmMode === 'astar' || algorithmMode === 'both') {
            visualizeArc(data.astar_path, 0x28a745, 'astar');
        }
        if (algorithmMode === 'dijkstra' || algorithmMode === 'both') {
            if (data.dijkstra_path) {
                visualizeArc(data.dijkstra_path, 0x0dcaf0, 'dijkstra');
            }
        }
    }

    displayRouteResults(data, algorithmMode);
    showSearchExplanation(originIata, destinationIata, data, algorithmMode);
}

// --- 시뮬레이션 로직 ---
function toggleSimulation() {
    simulationRunning = !simulationRunning;
    const button = document.getElementById('toggle-sim');
    button.textContent = simulationRunning ? '시뮬레이션 정지' : '시뮬레이션 시작';
    button.classList.toggle('btn-danger', simulationRunning);
    button.classList.toggle('btn-success', !simulationRunning);

    const simInsightEl = document.getElementById('sim-insight-panel');
    if (simulationRunning) {
        lastSimInsightTime = 0;
        if (simInsightEl && currentMode === 'sim') {
            simInsightEl.style.display = 'block';
        }
        if (airplanes.length === 0) {
            startSimulation();
        }
    } else {
        clearScene();
        if (simInsightEl && currentMode === 'sim') {
            simInsightEl.innerHTML =
                '<p class="small text-white-50 mb-0">중지됨. 다시 시작하면 주기적으로 알고리즘 관점 해석이 표시됩니다.</p>';
        }
    }
}

function startSimulation() {
    const airportIatas = Object.keys(airportsData);
    if (airportIatas.length === 0) return;
    for (let i = 0; i < airplaneCount; i++) {
        const origin = airportsData[airportIatas[Math.floor(Math.random() * airportIatas.length)]];
        const destination = airportsData[airportIatas[Math.floor(Math.random() * airportIatas.length)]];
        if (origin && destination && origin.iata_code !== destination.iata_code) {
            airplanes.push(new Airplane(origin, destination));
        }
    }
}

function restartSimulation() {
    clearScene();
    startSimulation();
}

class Airplane {
    constructor(origin, destination) {
        this.speed = (Math.random() * 0.4 + 0.2) * 0.002;
        const geometry = new THREE.ConeGeometry(0.03, 0.15, 8);
        geometry.rotateX(Math.PI / 2);
        const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
        this.mesh = new THREE.Mesh(geometry, material);
        scene.add(this.mesh);
        this.pathLine = null;
        this.setupPath(origin, destination);
        this.progress = Math.random();
    }

    setupPath(origin, destination) {
        if (this.pathLine) {
            scene.remove(this.pathLine);
            this.pathLine.geometry.dispose();
            this.pathLine.material.dispose();
        }
        this.origin = origin;
        this.destination = destination;
        const startVec = latLonToVector3(origin.latitude, origin.longitude, 5);
        const endVec = latLonToVector3(destination.latitude, destination.longitude, 5);
        const arcPoints = createGreatCircleArc(startVec, endVec);
        if (arcPoints.length < 2) {
            this.curve = null;
            this.pathLine = null;
            return;
        }
        this.curve = new THREE.CatmullRomCurve3(arcPoints);
        const tubeGeometry = new THREE.TubeGeometry(this.curve, 64, 0.015, 8, false); // Slightly wider
        const tubeMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }); // Slightly more opaque
        this.pathLine = new THREE.Mesh(tubeGeometry, tubeMaterial);
        this.pathLine.name = 'sim_path';
        scene.add(this.pathLine);
    }

    update() {
        if (!this.curve) {
            this.reset();
            return;
        }
        this.progress += this.speed * simulationSpeed;
        if (this.progress >= 1) {
            this.progress = 0;
            this.reset();
            return;
        }
        const newPosition = this.curve.getPointAt(this.progress);
        this.mesh.position.copy(newPosition);
        const nextPoint = this.curve.getPointAt(Math.min(this.progress + 0.001, 1));
        this.mesh.lookAt(nextPoint);
    }

    reset() {
        this.progress = 0;
        const airportIatas = Object.keys(airportsData);
        let newOrigin, newDestination;
        do {
            newOrigin = airportsData[airportIatas[Math.floor(Math.random() * airportIatas.length)]];
            newDestination = airportsData[airportIatas[Math.floor(Math.random() * airportIatas.length)]];
        } while (!newOrigin || !newDestination || newOrigin.iata_code === newDestination.iata_code);
        this.setupPath(newOrigin, newDestination);
    }
}

// --- 렌더링 및 유틸리티 함수 ---
function createGreatCircleArc(startVec, endVec) {
    const numPoints = 50;
    const points = [];
    const startUnit = startVec.clone().normalize();
    const endUnit = endVec.clone().normalize();
    let axis = new THREE.Vector3().crossVectors(startUnit, endUnit).normalize();
    if (isNaN(axis.x) || isNaN(axis.y) || isNaN(axis.z)) {
        if (startUnit.distanceTo(endUnit) < 0.001) { return [startVec]; }
        const nonCollinearVec = (Math.abs(startUnit.x) < 0.9) ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
        axis = new THREE.Vector3().crossVectors(startUnit, nonCollinearVec).normalize();
    }
    const angle = startUnit.angleTo(endUnit);
    const distance = startVec.distanceTo(endVec);
    const maxHeight = Math.max(0.05, distance * 0.2);
    for (let i = 0; i <= numPoints; i++) {
        const t = i / numPoints;
        const rotation = new THREE.Quaternion().setFromAxisAngle(axis, angle * t);
        const point = startVec.clone().applyQuaternion(rotation);
        const height = maxHeight * Math.sin(t * Math.PI);
        point.setLength(5 + height);
        points.push(point);
    }
    return points;
}

function visualizeArc(path, color, name) {
    const points = path.map(iata => latLonToVector3(airportsData[iata].latitude, airportsData[iata].longitude, 5));
    const curvePoints = [];
    for (let i = 0; i < points.length - 1; i++) {
        const start = points[i];
        const end = points[i+1];
        const arcPoints = createGreatCircleArc(start, end);
        curvePoints.push(...(i > 0 ? arcPoints.slice(1) : arcPoints));
    }
    if (curvePoints.length < 2) { return; }
    const pathCurve = new THREE.CatmullRomCurve3(curvePoints);
    let tubeRadius = 0.02;
    if (name === 'astar') tubeRadius = 0.03;
    else if (name === 'dijkstra') tubeRadius = 0.028;

    let material;
    if (name === 'astar') {
        material = new THREE.MeshPhongMaterial({ color: color, transparent: true, opacity: 0.9, emissive: color, emissiveIntensity: 0.3 });
    } else if (name === 'dijkstra') {
        material = new THREE.MeshPhongMaterial({ color: color, transparent: true, opacity: 0.88, emissive: color, emissiveIntensity: 0.25 });
    } else {
        material = new THREE.MeshPhongMaterial({ color: color, transparent: true, opacity: 0.8 });
    }
    const geometry = new THREE.TubeGeometry(pathCurve, 256, tubeRadius, 8, false);
    const arc = new THREE.Mesh(geometry, material);
    arc.name = name;
    scene.add(arc);
}

function formatPathLine(path) {
    return path.map((iata) => (airportsData[iata] ? `${airportsData[iata].name} (${iata})` : iata)).join(' → ');
}

function displayRouteResults(data, algorithmMode) {
    const resultsPanel = document.getElementById('results-panel');
    const directKm = Math.round(data.direct_distance);
    const fallbackPath = data.fallback_path || [];

    if (!data.astar_path) {
        resultsPanel.innerHTML = `
            <div class="path-result direct-path"><strong>직선 거리:</strong> ${directKm} km</div>
            <p class="text-center mt-2"><strong>경로:</strong> ${formatPathLine(fallbackPath)}</p>
            <p class="text-center mt-3">그래프상 탐색 가능한 경로가 없습니다. (직항만 표시)</p>
        `;
        return;
    }

    const astarKm = Math.round(data.astar_distance);
    const dijkstraKm = data.dijkstra_distance != null ? Math.round(data.dijkstra_distance) : null;
    const sameCost =
        dijkstraKm != null &&
        Math.abs(data.astar_distance - data.dijkstra_distance) < 0.01;
    const sameSequence =
        data.dijkstra_path &&
        data.astar_path.join(',') === data.dijkstra_path.join(',');

    let content = '';
    if (algorithmMode === 'both') {
        content += `<p class="text-center small text-white-50 mb-2">지도: 초록 A* · 시안 다익스트라 · 노랑 직선(대권 거리)</p>`;
    }
    content += `<div class="path-result direct-path"><strong>직선 거리(대권):</strong> ${directKm} km</div>`;

    if (algorithmMode === 'astar' || algorithmMode === 'both') {
        content += `<div class="path-result astar-path"><strong>A* 누적 비용:</strong> ${astarKm} units</div>`;
        content += `<p class="text-center mt-2 small"><strong>A* 경로:</strong> ${formatPathLine(data.astar_path)}</p>`;
    }
    if ((algorithmMode === 'dijkstra' || algorithmMode === 'both') && data.dijkstra_path) {
        content += `<div class="path-result dijkstra-path"><strong>다익스트라 누적 비용:</strong> ${dijkstraKm} units</div>`;
        content += `<p class="text-center mt-2 small"><strong>다익스트라 경로:</strong> ${formatPathLine(data.dijkstra_path)}</p>`;
    }

    if (algorithmMode === 'both' && data.dijkstra_path) {
        if (sameCost && sameSequence) {
            content += `<p class="text-center mt-3 small">동일한 최소 비용·동일 경로 (휴리스틱이 허용 가능하면 A*도 최단과 일치)</p>`;
        } else if (sameCost && !sameSequence) {
            content += `<p class="text-center mt-3 small">비용은 같고 경로만 다른 경우(동률)일 수 있습니다.</p>`;
        }
    }

    const diffVersusDirect = Math.round(directKm - astarKm);
    if (diffVersusDirect > 0) {
        content += `<p class="text-center mt-2">그래프 최단 비용이 직선 거리(km)보다 <strong>${diffVersusDirect}</strong>만큼 작게 나올 수 있습니다. (km와 units는 다른 척도입니다)</p>`;
    }

    content += `<small class="d-block text-center text-muted mt-2">edge 비용 = 구간 거리(km) × ${EFFICIENCY_FACTOR}</small>`;
    resultsPanel.innerHTML = content;
}

function pathLengthKmAlongPath(path) {
    if (!path || path.length < 2) return 0;
    let s = 0;
    for (let i = 0; i < path.length - 1; i++) {
        const a = airportsData[path[i]];
        const b = airportsData[path[i + 1]];
        if (a && b) s += haversineDistance(a, b);
    }
    return s;
}

function singleLegFeasibleInGraph(originIata, destIata) {
    if (!airportsData[originIata] || !airportsData[destIata]) return false;
    return haversineDistance(airportsData[originIata], airportsData[destIata]) <= MAX_DIRECT_DISTANCE_KM;
}

/** 경로 탐색: 왜 이런 계산을 했는지 (모델 + 알고리즘별) */
function showSearchExplanation(originIata, destIata, data, algorithmMode) {
    const el = document.getElementById('explain-panel');
    if (!el || currentMode !== 'search') return;

    const directKm = Math.round(data.direct_distance);
    const oneHop = singleLegFeasibleInGraph(originIata, destIata);

    let html = '<h6 class="mb-2">왜 이렇게 계산했나요?</h6>';
    html += '<ul class="mb-2">';
    html += `<li><strong>그래프</strong>: 두 공항 간 거리가 <strong>${MAX_DIRECT_DISTANCE_KM}km 이하</strong>일 때만 간선(직항 가능 구간)으로 연결했습니다.</li>`;
    html += `<li><strong>간선 비용</strong>: 대권 거리(km) × <strong>${EFFICIENCY_FACTOR}</strong> → 누적 합이 경로의 총 비용(units)입니다.</li>`;
    html += `<li><strong>직선 ${directKm}km</strong>는 참고용 대권 거리이며, 지도의 <strong>노란 선</strong>과 같은 개념입니다.</li>`;
    if (!oneHop) {
        html += `<li>이 출·도착지는 직선거리가 <strong>${MAX_DIRECT_DISTANCE_KM}km보다 김</strong> → 단 하나의 간선으로는 연결되지 않으므로, <strong>경유(여러 간선)</strong>가 필요합니다.</li>`;
    } else {
        html += `<li>직선거리가 ${MAX_DIRECT_DISTANCE_KM}km 이내라 <strong>단일 간선</strong>도 그래프에 있을 수 있습니다. 알고리즘은 그렇게 얻은 네트워크 위에서 <strong>비용 합 최소</strong> 경로를 고릅니다.</li>`;
    }
    html += '</ul>';

    if (!data.astar_path) {
        html += `<p class="mb-0 small text-warning">그래프로는 출발지에서 도착지까지 이어지는 경로가 없습니다. (중간 공항들을 거쳐도 연결이 안 되는 경우) 지도에는 직선만 그렸습니다.</p>`;
        el.innerHTML = html;
        el.style.display = 'block';
        return;
    }

    const hops = data.astar_path.length - 1;
    const pathKm = Math.round(pathLengthKmAlongPath(data.astar_path));
    const cost = Math.round(data.astar_distance);

    html += '<h6 class="mt-2 mb-1">알고리즘이 한 일</h6><ul class="mb-0">';

    if (algorithmMode === 'astar' || algorithmMode === 'both') {
        html +=
            '<li><strong>A*</strong>: 각 공항에서 목적지까지의 <strong>대권 직선 거리</strong>를 휴리스틱(추정치)으로 씁니다. 간선 비용은 음이 아니고, 휴리스틱은 실제 최단 거리를 <strong>과대평가하지 않아</strong> 허용 가능합니다. 그래서 “목표로 갈 가능성이 큰” 공항을 우선 펼쳐 <strong>덜 탐색하고도</strong> 최소 비용 경로(다익스트라와 동일 비용)를 찾을 수 있습니다.</li>';
    }
    if (algorithmMode === 'dijkstra' || algorithmMode === 'both') {
        html +=
            '<li><strong>다익스트라</strong>: 시작점에서부터 <strong>지금까지의 누적 비용이 작은 공항</strong>부터 확정해 나갑니다. 휴리스틱 없이 전 구역을 비용 순으로 퍼나가며, 음의 간선 비용이 없다는 전제에서 <strong>최소 누적 비용</strong> 경로가 보장됩니다.</li>';
    }
    if (algorithmMode === 'both') {
        html +=
            '<li><strong>둘 다 같은 그래프·같은 비용</strong>이면 최종 비용은 같게 나오는 것이 정상입니다. (경로 문자열이 같다면 동일 경로, 비용만 같으면 동률인 다른 최적 경로일 수 있습니다.)</li>';
    }

    html += `<li class="mt-1"><strong>이번 결과</strong>: <strong>${hops}번</strong> 경유, 간선 길이 합 약 <strong>${pathKm}km</strong>, 누적 비용 <strong>${cost}units</strong>.</li>`;
    html += '</ul>';

    el.innerHTML = html;
    el.style.display = 'block';
}

function maybeRefreshSimulationInsight() {
    const simInsightEl = document.getElementById('sim-insight-panel');
    if (!simInsightEl || currentMode !== 'sim' || airplanes.length === 0) return;

    const now = performance.now();
    if (now - lastSimInsightTime < SIM_INSIGHT_MS) return;
    lastSimInsightTime = now;

    const plane = airplanes[Math.floor(Math.random() * airplanes.length)];
    if (!plane.origin || !plane.destination) return;
    const o = plane.origin.iata_code;
    const d = plane.destination.iata_code;
    if (o === d) return;

    const data = calculateRouteLocally(o, d);
    const directKm = Math.round(haversineDistance(airportsData[o], airportsData[d]));
    const oneHop = singleLegFeasibleInGraph(o, d);

    let html = '<h6 class="mb-2">실시간 해석 (샘플 항적)</h6>';
    html += `<p class="mb-2 small">표본: <strong>${o} → ${d}</strong> · 직선 거리 약 <strong>${directKm}km</strong></p>`;

    if (data.astar_path) {
        const hops = data.astar_path.length - 1;
        const pathKm = Math.round(pathLengthKmAlongPath(data.astar_path));
        const astarCost = Math.round(data.astar_distance);
        const dijkCost = data.dijkstra_distance != null ? Math.round(data.dijkstra_distance) : astarCost;

        html += '<ul class="mb-2">';
        html += `<li><strong>알고리즘 기준 (동일 비용)</strong>: A*·다익스트라 모두 이 그래프에서 약 <strong>${astarCost}units</strong> (${hops}구간, 간선 합 거리 약 ${pathKm}km).</li>`;
        if (!oneHop) {
            html += `<li><strong>이득(실행 가능성)</strong>: 직선이 <strong>${MAX_DIRECT_DISTANCE_KM}km보다 길어</strong> 한 번에 연결할 수 없습니다. 경유 최적 경로를 쓰지 않으면 이 네트워크 모델로는 <strong>아예 도착 불가</strong>에 가깝습니다. 알고리즘은 “가능한 비행 구간”만으로 <strong>도달 가능한 최저 비용</strong>을 줍니다.</li>`;
        } else {
            html += `<li><strong>이득</strong>: 단일 간선도 있지만, 여러 간선을 합친 경로가 <strong>누적 비용이 더 작을 수</strong> 있습니다. 화면 비행기는 <strong>직선 대권</strong>만 따르므로 이 수치와는 별개입니다.</li>`;
        }
        html += `<li class="small text-white-50">직선 ${directKm}km와 units는 단위가 다릅니다. 비교는 “같은 모델 안에서의 최적 경로”로 보시면 됩니다.</li>`;
        html += '</ul>';
        html += `<p class="mb-0 small"><strong>실시간 요약</strong>: 다익≈<strong>${dijkCost}</strong> units · A*≈<strong>${astarCost}</strong> units (동일 그래프 최적)</p>`;
    } else {
        html += `<p class="mb-0 small text-warning">이 샘플 구간은 그래프에 경로가 없습니다. 화면의 비행기는 직선만 비행하는 중입니다.</p>`;
    }

    simInsightEl.innerHTML = html;
}

function latLonToVector3(lat, lon, radius) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);
    const x = -(radius * Math.sin(phi) * Math.cos(theta));
    const y = radius * Math.cos(phi);
    const z = radius * Math.sin(phi) * Math.sin(theta);
    return new THREE.Vector3(x, y, z);
}

function haversineDistance(airport1, airport2) {
    const R = 6371; // km
    const lat1 = airport1.latitude * Math.PI / 180;
    const lon1 = airport1.longitude * Math.PI / 180;
    const lat2 = airport2.latitude * Math.PI / 180;
    const lon2 = airport2.longitude * Math.PI / 180;
    const dlon = lon2 - lon1;
    const dlat = lat2 - lat1;
    const a = Math.sin(dlat / 2)**2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlon / 2)**2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function clearScene() {
    for (let i = scene.children.length - 1; i >= 0; i--) {
        const obj = scene.children[i];
        if (obj.type === 'Mesh' && (obj.name === 'astar' || obj.name === 'dijkstra' || obj.name === 'direct' || obj.name === 'sim_path')) {
            scene.remove(obj);
            obj.geometry.dispose();
            obj.material.dispose();
        }
    }
    airplanes.forEach(plane => {
        if (plane.mesh) {
            scene.remove(plane.mesh);
            plane.mesh.geometry.dispose();
            plane.mesh.material.dispose();
        }
    });
    airplanes = [];
}

function setUiLoadingState(isLoading, message = '') {
    const calculateButton = document.getElementById('calculate');
    const exampleButton = document.getElementById('show-example');
    const simButton = document.getElementById('toggle-sim');
    calculateButton.disabled = isLoading;
    exampleButton.disabled = isLoading;
    simButton.disabled = isLoading;
    const explainEl = document.getElementById('explain-panel');
    if (message) {
        document.getElementById('results-panel').innerHTML = `<p class="text-center text-warning">${message}</p>`;
        if (explainEl) {
            explainEl.innerHTML = '';
            explainEl.style.display = 'none';
        }
    } else if (!isLoading) {
        document.getElementById('results-panel').innerHTML = '';
        if (explainEl) {
            explainEl.innerHTML = '';
            explainEl.style.display = 'none';
        }
    }
}

async function loadDataForStaticHosting() {
    const [airportsCsv, runwaysCsv] = await Promise.all([
        fetch('./airports_all.csv').then((res) => {
            if (!res.ok) throw new Error('airports_all.csv 로딩 실패');
            return res.text();
        }),
        fetch('./runways.csv').then((res) => {
            if (!res.ok) throw new Error('runways.csv 로딩 실패');
            return res.text();
        })
    ]);

    const runwayRows = parseCSV(runwaysCsv);
    const runwayAirportIds = new Set();
    runwayRows.forEach((row) => {
        if (row.airport_ref) {
            runwayAirportIds.add(row.airport_ref);
        }
    });

    const airportRows = parseCSV(airportsCsv);
    allAirports = [];
    airportsData = {};
    airportGraph = {};

    airportRows.forEach((row) => {
        const isValidType = row.type === 'medium_airport' || row.type === 'large_airport';
        const hasScheduledService = row.scheduled_service === 'yes';
        const hasIataCode = Boolean(row.iata_code);
        const hasRunway = runwayAirportIds.has(row.id);
        if (!isValidType || !hasScheduledService || !hasIataCode || !hasRunway) return;

        const latitude = Number.parseFloat(row.latitude_deg);
        const longitude = Number.parseFloat(row.longitude_deg);
        if (Number.isNaN(latitude) || Number.isNaN(longitude)) return;

        const airport = {
            id: row.id,
            iata_code: row.iata_code,
            name: row.name,
            type: row.type,
            latitude,
            longitude,
            iso_country: row.iso_country,
            continent: row.continent
        };

        allAirports.push(airport);
        airportsData[airport.iata_code] = airport;
    });

    buildAirportGraph();
}

function buildAirportGraph() {
    for (let i = 0; i < allAirports.length; i++) {
        const airport1 = allAirports[i];
        const iata1 = airport1.iata_code;
        if (!airportGraph[iata1]) {
            airportGraph[iata1] = [];
        }
        for (let j = i + 1; j < allAirports.length; j++) {
            const airport2 = allAirports[j];
            const iata2 = airport2.iata_code;
            const distance = haversineDistance(airport1, airport2);
            if (distance <= MAX_DIRECT_DISTANCE_KM) {
                if (!airportGraph[iata2]) {
                    airportGraph[iata2] = [];
                }
                const efficientDistance = distance * EFFICIENCY_FACTOR;
                airportGraph[iata1].push([iata2, efficientDistance]);
                airportGraph[iata2].push([iata1, efficientDistance]);
            }
        }
    }
}

function calculateRouteLocally(originIata, destinationIata) {
    if (!originIata || !destinationIata || !airportsData[originIata] || !airportsData[destinationIata]) {
        return {
            astar_path: null,
            dijkstra_path: null,
            astar_distance: null,
            dijkstra_distance: null,
            direct_distance: null,
            fallback_path: null
        };
    }
    const directDistance = haversineDistance(airportsData[originIata], airportsData[destinationIata]);
    const [astarPath, astarCost] = aStarSearch(originIata, destinationIata);
    const [dijkstraPath, dijkstraCost] = dijkstraSearch(originIata, destinationIata);

    if (astarPath) {
        return {
            astar_path: astarPath,
            dijkstra_path: dijkstraPath,
            astar_distance: astarCost,
            dijkstra_distance: dijkstraPath ? dijkstraCost : null,
            direct_distance: directDistance,
            fallback_path: null
        };
    }
    return {
        astar_path: null,
        dijkstra_path: null,
        astar_distance: null,
        dijkstra_distance: null,
        direct_distance: directDistance,
        fallback_path: [originIata, destinationIata]
    };
}

function aStarSearch(startNode, goalNode) {
    if (!airportGraph[startNode] || !airportGraph[goalNode]) {
        return [null, Infinity];
    }

    const openSet = [[0, startNode]];
    const cameFrom = {};
    const gScore = {};
    const fScore = {};
    Object.keys(airportGraph).forEach((node) => {
        gScore[node] = Infinity;
        fScore[node] = Infinity;
    });
    gScore[startNode] = 0;
    fScore[startNode] = haversineDistance(airportsData[startNode], airportsData[goalNode]);

    while (openSet.length > 0) {
        openSet.sort((a, b) => a[0] - b[0]);
        const [, current] = openSet.shift();

        if (current === goalNode) {
            const path = [];
            let node = current;
            while (cameFrom[node]) {
                path.push(node);
                node = cameFrom[node];
            }
            path.push(startNode);
            return [path.reverse(), gScore[goalNode]];
        }

        const neighbors = airportGraph[current] || [];
        neighbors.forEach(([neighbor, distance]) => {
            const tentativeGScore = gScore[current] + distance;
            if (tentativeGScore < (gScore[neighbor] ?? Infinity)) {
                cameFrom[neighbor] = current;
                gScore[neighbor] = tentativeGScore;
                const hScore = haversineDistance(airportsData[neighbor], airportsData[goalNode]);
                fScore[neighbor] = tentativeGScore + hScore;
                openSet.push([fScore[neighbor], neighbor]);
            }
        });
    }

    return [null, Infinity];
}

function dijkstraSearch(startNode, goalNode) {
    if (!airportGraph[startNode] || !airportGraph[goalNode]) {
        return [null, Infinity];
    }

    const dist = {};
    const cameFrom = {};
    Object.keys(airportGraph).forEach((node) => {
        dist[node] = Infinity;
    });
    dist[startNode] = 0;
    const openSet = [[0, startNode]];

    while (openSet.length > 0) {
        openSet.sort((a, b) => a[0] - b[0]);
        const [d, current] = openSet.shift();
        if (d > dist[current]) continue;

        if (current === goalNode) {
            const path = [];
            let node = current;
            while (cameFrom[node]) {
                path.push(node);
                node = cameFrom[node];
            }
            path.push(startNode);
            return [path.reverse(), dist[goalNode]];
        }

        const neighbors = airportGraph[current] || [];
        neighbors.forEach(([neighbor, edge]) => {
            const alt = dist[current] + edge;
            if (alt < dist[neighbor]) {
                dist[neighbor] = alt;
                cameFrom[neighbor] = current;
                openSet.push([alt, neighbor]);
            }
        });
    }

    return [null, Infinity];
}

function parseCSV(text) {
    const rows = [];
    let row = [];
    let value = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                value += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            row.push(value);
            value = '';
        } else if ((char === '\n' || char === '\r') && !inQuotes) {
            if (char === '\r' && nextChar === '\n') i++;
            row.push(value);
            value = '';
            if (row.some((cell) => cell !== '')) {
                rows.push(row);
            }
            row = [];
        } else {
            value += char;
        }
    }
    if (value.length > 0 || row.length > 0) {
        row.push(value);
        rows.push(row);
    }
    if (rows.length === 0) return [];

    const headers = rows[0].map((header) => header.trim());
    return rows.slice(1).map((cells) => {
        const obj = {};
        headers.forEach((header, index) => {
            obj[header] = (cells[index] ?? '').trim();
        });
        return obj;
    });
}

// --- 실행 ---
init();
