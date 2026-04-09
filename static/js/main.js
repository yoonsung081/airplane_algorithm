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

// --- 애니메이션 루프 ---
function animate() {
    animationFrameId = requestAnimationFrame(animate);
    controls.update();
    if (simulationRunning) {
        airplanes.forEach(plane => plane.update());
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
    const countrySelect = document.getElementById('country-filter');
    const originSelect = document.getElementById('origin');
    const destinationSelect = document.getElementById('destination');

    // 대륙 필터 채우기
    const continents = ['All', ...new Set(allAirports.map(a => a.continent))].sort();
    continents.forEach(c => continentSelect.add(new Option(c, c)));

    updateCountryFilter(); // 국가 필터 초기화
}

function updateCountryFilter() {
    const continent = document.getElementById('continent-filter').value;
    const countrySelect = document.getElementById('country-filter');
    countrySelect.innerHTML = ''; // Clear previous options

    const filteredAirportsByContinent = (continent === 'All') ? allAirports : allAirports.filter(a => a.continent === continent);
    const countries = ['All', ...new Set(filteredAirportsByContinent.map(a => a.iso_country))].sort();
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
    
    document.getElementById('continent-search').addEventListener('input', filterDropdownOptions.bind(null, 'continent-filter', allAirports.map(a => a.continent)));
    document.getElementById('country-search').addEventListener('input', () => {
        const continent = document.getElementById('continent-filter').value;
        const filteredAirportsByContinent = (continent === 'All') ? allAirports : allAirports.filter(a => a.continent === continent);
        filterDropdownOptions('country-filter', filteredAirportsByContinent.map(a => a.iso_country));
    });
    document.getElementById('origin-search').addEventListener('input', updateAirportSelects);
    document.getElementById('destination-search').addEventListener('input', updateAirportSelects);

    document.getElementById('mode-search').addEventListener('click', () => switchMode('search'));
    document.getElementById('mode-sim').addEventListener('click', () => switchMode('sim'));
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

    selectElement.innerHTML = '';
    const filteredOptions = ['All', ...new Set(allPossibleOptions)].sort().filter(option => 
        option.toLowerCase().includes(searchText)
    );
    filteredOptions.forEach(option => selectElement.add(new Option(option, option)));

    // Trigger change to update dependent dropdowns if applicable
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

    if (mode === 'search') {
        document.getElementById('search-panel').style.display = 'block';
        document.getElementById('sim-controls').style.display = 'none';
        document.getElementById('mode-search').classList.add('active');
        document.getElementById('mode-sim').classList.remove('active');
    } else {
        document.getElementById('search-panel').style.display = 'none';
        document.getElementById('sim-controls').style.display = 'block';
        document.getElementById('mode-search').classList.remove('active');
        document.getElementById('mode-sim').classList.add('active');
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

function calculateAndVisualize(originIata, destinationIata) {
    if (!originIata || !destinationIata) return;
    const data = calculateRouteLocally(originIata, destinationIata);
    clearScene();
    if (data.path) {
        visualizeArc(data.path, 0x28a745, 'astar');
        const directPath = [originIata, destinationIata];
        visualizeArc(directPath, 0xffc107, 'direct');
        displayResults(data.astar_distance, data.direct_distance, data.path);
    }
}

// --- 시뮬레이션 로직 ---
function toggleSimulation() {
    simulationRunning = !simulationRunning;
    const button = document.getElementById('toggle-sim');
    button.textContent = simulationRunning ? '시뮬레이션 정지' : '시뮬레이션 시작';
    button.classList.toggle('btn-danger', simulationRunning);
    button.classList.toggle('btn-success', !simulationRunning);

    if (simulationRunning && airplanes.length === 0) {
        startSimulation();
    } else if (!simulationRunning) {
        clearScene();
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
    const tubeRadius = (name === 'astar') ? 0.03 : 0.02;
    const material = (name === 'astar') 
        ? new THREE.MeshPhongMaterial({ color: color, transparent: true, opacity: 0.9, emissive: color, emissiveIntensity: 0.3 }) 
        : new THREE.MeshPhongMaterial({ color: color, transparent: true, opacity: 0.8 });
    const geometry = new THREE.TubeGeometry(pathCurve, 256, tubeRadius, 8, false);
    const arc = new THREE.Mesh(geometry, material);
    arc.name = name;
    scene.add(arc);
}

function displayResults(astarDistance, directDistance, path) {
    const resultsPanel = document.getElementById('results-panel');
    const directKm = Math.round(directDistance);
    let pathString = path.map(iata => airportsData[iata] ? `${airportsData[iata].name} (${iata})` : iata).join(' → ');

    if (astarDistance !== null) {
        const astarKm = Math.round(astarDistance);
        const difference = Math.round(directKm - astarKm);

        let content = `
            <div class="path-result astar-path"><strong>A* 효율 비용:</strong> ${astarKm} units</div>
            <div class="path-result direct-path"><strong>직선 거리 비용:</strong> ${directKm} units</div>
            <p class="text-center mt-2"><strong>경로:</strong> ${pathString}</p>
        `;

        if (difference > 0) {
            content += `<p class="text-center mt-3">A* 알고리즘이 <strong>${difference} units</strong> 만큼 더 효율적인 경로를 찾았습니다.</p>
                      <small class="d-block text-center text-muted mt-2">(효율 비용은 연료, 항로 이용료 등을 종합한 가상 단위입니다)</small>`;
        } else {
            content += `<p class="text-center mt-3">이 구간은 직선 항로가 더 효율적입니다.</p>`;
        }
        resultsPanel.innerHTML = content;
    } else {
        resultsPanel.innerHTML = `
            <div class="path-result direct-path"><strong>직선 거리:</strong> ${directKm} km</div>
            <p class="text-center mt-2"><strong>경로:</strong> ${pathString}</p>
            <p class="text-center mt-3">탐색 가능한 A* 경로가 없습니다.</p>
        `;
    }
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
        if (obj.type === 'Mesh' && (obj.name === 'astar' || obj.name === 'direct' || obj.name === 'sim_path')) {
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
    if (message) {
        document.getElementById('results-panel').innerHTML = `<p class="text-center text-warning">${message}</p>`;
    } else if (!isLoading) {
        document.getElementById('results-panel').innerHTML = '';
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
        return { path: null, astar_distance: null, direct_distance: null };
    }
    const [path, astarCost] = aStarSearch(originIata, destinationIata);
    const directDistance = haversineDistance(airportsData[originIata], airportsData[destinationIata]);
    if (path) {
        return { path, astar_distance: astarCost, direct_distance: directDistance };
    }
    return {
        path: [originIata, destinationIata],
        astar_distance: null,
        direct_distance: directDistance
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
