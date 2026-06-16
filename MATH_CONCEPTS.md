# 수학적 개념과 코드 구현

이 프로젝트는 **3D 항공 네트워크 시뮬레이터**로, 실제 공항 데이터를 기반으로 최단 경로를 탐색합니다.  
아래에서 각 수학적 개념이 코드에 어떻게 구현되어 있는지 설명합니다.

---

## 1. 하버사인 공식 (Haversine Formula)

### 개념

지구는 구(球)이므로, 평면 유클리드 거리로 두 지점 사이의 거리를 계산하면 오차가 생깁니다.  
하버사인 공식은 **구면 기하학**을 이용해 위도·경도 좌표 두 점 사이의 **대권 거리(Great-Circle Distance)**를 구합니다.

$$
a = \sin^2\!\left(\frac{\Delta\phi}{2}\right) + \cos\phi_1 \cdot \cos\phi_2 \cdot \sin^2\!\left(\frac{\Delta\lambda}{2}\right)
$$
$$
c = 2 \cdot \text{atan2}\!\left(\sqrt{a},\, \sqrt{1-a}\right)
$$
$$
d = R \cdot c
$$

- $\phi$: 위도 (라디안), $\lambda$: 경도 (라디안)
- $R = 6371\,\text{km}$: 지구 평균 반지름

### Python 구현 (`app.py:17-24`)

```python
def calculate_haversine_distance(lat1, lon1, lat2, lon2):
    R = 6371.0
    lat1_rad, lon1_rad, lat2_rad, lon2_rad = map(radians, [lat1, lon1, lat2, lon2])
    dlon = lon2_rad - lon1_rad
    dlat = lat2_rad - lat1_rad
    a = sin(dlat / 2)**2 + cos(lat1_rad) * cos(lat2_rad) * sin(dlon / 2)**2
    c = 2 * atan2(sqrt(a), sqrt(1 - a))
    return R * c
```

### JavaScript 구현 (`main.js:644-655`)

```js
function haversineDistance(airport1, airport2) {
    const R = 6371;
    const lat1 = airport1.latitude * Math.PI / 180;
    const lon1 = airport1.longitude * Math.PI / 180;
    const lat2 = airport2.latitude * Math.PI / 180;
    const lon2 = airport2.longitude * Math.PI / 180;
    const dlon = lon2 - lon1;
    const dlat = lat2 - lat1;
    const a = Math.sin(dlat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dlon/2)**2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
```

**핵심 포인트:** 각도를 반드시 라디안으로 변환(`* Math.PI / 180`)한 뒤 삼각함수에 넣어야 합니다.

---

## 2. 구면 좌표계 → 데카르트 좌표계 변환

### 개념

3D 지구본 렌더링에서 위도·경도 좌표를 Three.js의 3D 공간 좌표 `(x, y, z)`로 변환해야 합니다.  
구면 좌표계 $(r, \phi, \theta)$에서 데카르트 좌표계 $(x, y, z)$로의 변환 공식:

$$
x = r \sin\phi \cos\theta
$$
$$
y = r \cos\phi
$$
$$
z = r \sin\phi \sin\theta
$$

- $\phi = (90° - \text{lat}) \times \frac{\pi}{180}$: 극각 (위도에서 변환)
- $\theta = (\text{lon} + 180°) \times \frac{\pi}{180}$: 방위각 (경도에서 변환)

### JavaScript 구현 (`main.js:635-642`)

```js
function latLonToVector3(lat, lon, radius) {
    const phi   = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);
    const x = -(radius * Math.sin(phi) * Math.cos(theta));
    const y =   radius * Math.cos(phi);
    const z =   radius * Math.sin(phi) * Math.sin(theta);
    return new THREE.Vector3(x, y, z);
}
```

**핵심 포인트:** Three.js 좌표계는 Y축이 위쪽이고, 경도 오프셋(+180°)과 x축 부호 반전(-)으로  
지리 좌표계와의 방향 차이를 보정합니다.

---

## 3. 대권 호 (Great Circle Arc) — 벡터 연산·쿼터니언 회전

### 개념

두 공항 사이의 가장 짧은 구면 경로인 **대권(Great Circle)**을 3D 공간에서 호로 그립니다.  
이를 위해 다음 두 가지 벡터 연산이 핵심입니다.

#### 3-1. 외적 (Cross Product) — 회전축 계산

$$
\vec{axis} = \hat{v}_1 \times \hat{v}_2
$$

두 단위벡터의 외적은 두 벡터 모두에 수직인 벡터, 즉 대권이 놓인 평면의 법선벡터가 됩니다.  
이 벡터를 회전축으로 사용합니다.

#### 3-2. 내적과 사잇각 (Dot Product & Angle)

$$
\theta = \arccos(\hat{v}_1 \cdot \hat{v}_2)
$$

두 단위벡터의 사잇각을 구해, 회전 총량을 결정합니다.

#### 3-3. 쿼터니언 회전 (Quaternion Rotation)

매개변수 $t \in [0, 1]$에 따라 시작 벡터를 회전축 주위로 $\theta \cdot t$만큼 회전시켜 호 위의 점을 생성합니다.

$$
\vec{p}(t) = Q(axis,\, \theta \cdot t) \cdot \vec{v}_{start}
$$

#### 3-4. 높이 오프셋 (Arc Height)

경로가 지구 표면에서 살짝 떠 보이도록, 사인 함수로 중간이 높고 양 끝이 낮은 호를 만듭니다.

$$
\text{height}(t) = h_{max} \cdot \sin(t \cdot \pi)
$$

### JavaScript 구현 (`main.js:409-432`)

```js
function createGreatCircleArc(startVec, endVec) {
    const numPoints = 50;
    const startUnit = startVec.clone().normalize();
    const endUnit   = endVec.clone().normalize();

    // 외적으로 회전축 계산
    let axis = new THREE.Vector3().crossVectors(startUnit, endUnit).normalize();

    // 사잇각 계산
    const angle    = startUnit.angleTo(endUnit);
    const distance = startVec.distanceTo(endVec);
    const maxHeight = Math.max(0.05, distance * 0.2);

    const points = [];
    for (let i = 0; i <= numPoints; i++) {
        const t = i / numPoints;
        // 쿼터니언 회전: 회전축 주위로 angle*t 만큼 회전
        const rotation = new THREE.Quaternion().setFromAxisAngle(axis, angle * t);
        const point = startVec.clone().applyQuaternion(rotation);
        // 사인 곡선으로 호 높이 부여
        const height = maxHeight * Math.sin(t * Math.PI);
        point.setLength(5 + height);
        points.push(point);
    }
    return points;
}
```

---

## 4. 그래프 이론 (Graph Theory) — 인접 리스트

### 개념

공항들을 **노드(Vertex)**, 3,000 km 이하 구간을 **간선(Edge)**으로 삼아 가중 무방향 그래프를 구성합니다.  
간선의 가중치(비용)는 하버사인 거리에 효율성 계수를 곱한 값입니다.

$$
w(u, v) = d_{haversine}(u, v) \times 0.7
$$

그래프는 **인접 리스트(Adjacency List)** 구조로 저장하여, 각 노드에서 이웃 노드와 비용을 O(1)에 접근합니다.

### Python 구현 (`app.py:86-104`)

```python
max_dist = 3000        # 직항 최대 거리 (km)
efficiency_factor = 0.7

for i, airport1 in enumerate(temp_airports_list):
    for j in range(i + 1, len(temp_airports_list)):  # 중복 없이 쌍 생성
        airport2 = temp_airports_list[j]
        dist = calculate_haversine_distance(...)

        if dist <= max_dist:
            efficient_dist = dist * efficiency_factor
            # 무방향: 양쪽 모두 추가
            airport_graph[iata1].append((iata2, efficient_dist))
            airport_graph[iata2].append((iata1, efficient_dist))
```

**핵심 포인트:** `for j in range(i+1, ...)` 패턴으로 각 쌍을 한 번만 계산하고 양방향으로 등록해  
$O(n^2)$ 비교를 최소화합니다.

### JavaScript 구현 (`main.js:753-774`)

```js
function buildAirportGraph() {
    for (let i = 0; i < allAirports.length; i++) {
        for (let j = i + 1; j < allAirports.length; j++) {
            const distance = haversineDistance(airport1, airport2);
            if (distance <= MAX_DIRECT_DISTANCE_KM) {
                const efficientDistance = distance * EFFICIENCY_FACTOR;
                airportGraph[iata1].push([iata2, efficientDistance]);
                airportGraph[iata2].push([iata1, efficientDistance]);
            }
        }
    }
}
```

---

## 5. 다익스트라 알고리즘 (Dijkstra's Algorithm)

### 개념

**단일 출발점 최단 경로(Single-Source Shortest Path)** 알고리즘입니다.  
모든 간선 비용이 **음수가 아닐 때** 최적 경로를 보장합니다.

**핵심 아이디어:** 현재까지 확인된 최소 비용 $d[v]$ 를 관리하고,  
미확정 노드 중 $d[v]$가 가장 작은 노드를 꺼내 이웃을 **완화(Relaxation)**합니다.

$$
d[v] \leftarrow \min(d[v],\; d[u] + w(u,v))
$$

| 단계 | 조건 | 동작 |
|------|------|------|
| 초기화 | — | $d[\text{start}]=0$, 나머지 $d[v]=\infty$ |
| 추출 | $d[u]$가 최소인 노드 $u$ | 목표면 종료, 아니면 이웃 완화 |
| 완화 | $d[u]+w < d[v]$ | $d[v]$ 갱신, 경로 기록 |

### JavaScript 구현 (`main.js:858-899`)

```js
function dijkstraSearch(startNode, goalNode) {
    const dist = {};
    Object.keys(airportGraph).forEach(node => { dist[node] = Infinity; });
    dist[startNode] = 0;
    const openSet = [[0, startNode]];   // [비용, 노드]

    while (openSet.length > 0) {
        openSet.sort((a, b) => a[0] - b[0]);
        const [d, current] = openSet.shift();

        if (d > dist[current]) continue; // 이미 더 짧은 경로로 처리됨

        if (current === goalNode) { /* 경로 역추적 후 반환 */ }

        airportGraph[current].forEach(([neighbor, edge]) => {
            const alt = dist[current] + edge;
            if (alt < dist[neighbor]) {         // 완화
                dist[neighbor] = alt;
                cameFrom[neighbor] = current;
                openSet.push([alt, neighbor]);
            }
        });
    }
}
```

**핵심 포인트:** `if (d > dist[current]) continue` 조건으로 이미 최적화된 노드를  
중복 처리하지 않습니다(지연 삭제 패턴, Lazy Deletion).

---

## 6. A* 알고리즘 (A\* Search)

### 개념

A\*는 다익스트라에 **휴리스틱 함수 $h(v)$** 를 더해 목표 방향으로 탐색을 유도합니다.

$$
f(v) = g(v) + h(v)
$$

- $g(v)$: 출발점에서 $v$까지 실제 누적 비용
- $h(v)$: $v$에서 목적지까지의 **추정 비용 (휴리스틱)**

이 프로젝트에서는 **하버사인 거리**를 휴리스틱으로 사용합니다.

$$
h(v) = d_{haversine}(v, \text{goal})
$$

#### 허용 가능 휴리스틱 (Admissible Heuristic)

간선 비용 = 실제 거리 × 0.7이므로, 휴리스틱(= 실제 거리 × 1.0)은 항상 실제 비용보다  
**크거나 같습니다.** 이는 휴리스틱이 실제 비용을 **과대평가하지 않는다** 는 조건을 만족하지 않는 것처럼 보이지만, 실제로는 다음을 보장합니다:

> $h(v) \ge$ (실제 남은 비용) → 허용 가능하지 않아 **최적 보장은 없으나**,  
> 실제 사용에서는 그래프의 비용이 거리 × 0.7이므로 여전히 빠른 수렴을 보입니다.

### Python 구현 (`app.py:112-145`)

```python
def a_star_search(start_node, goal_node):
    open_set = [(0, start_node)]          # (f_score, node)
    g_score = {node: float('inf') for node in airport_graph}
    g_score[start_node] = 0
    f_score[start_node] = haversine(start, goal)  # 초기 휴리스틱

    while open_set:
        _, current = heapq.heappop(open_set)     # f_score 최소 노드 추출

        if current == goal_node:
            # 경로 역추적
            ...

        for neighbor, distance in airport_graph[current]:
            tentative_g = g_score[current] + distance
            if tentative_g < g_score[neighbor]:
                g_score[neighbor] = tentative_g
                h = haversine(neighbor, goal)
                f_score[neighbor] = tentative_g + h
                heapq.heappush(open_set, (f_score[neighbor], neighbor))
```

**Python에서의 최적화:** `heapq`(최소 힙)를 사용해 $f$값이 가장 작은 노드를 $O(\log n)$에 추출합니다.

### JavaScript 구현 (`main.js:811-856`)

```js
function aStarSearch(startNode, goalNode) {
    const openSet = [[0, startNode]];
    gScore[startNode] = 0;
    fScore[startNode] = haversineDistance(airportsData[startNode], airportsData[goalNode]);

    while (openSet.length > 0) {
        openSet.sort((a, b) => a[0] - b[0]);  // f값 오름차순 정렬
        const [, current] = openSet.shift();

        if (current === goalNode) { /* 경로 역추적 */ }

        neighbors.forEach(([neighbor, distance]) => {
            const tentativeGScore = gScore[current] + distance;
            if (tentativeGScore < (gScore[neighbor] ?? Infinity)) {
                gScore[neighbor] = tentativeGScore;
                const hScore = haversineDistance(airportsData[neighbor], airportsData[goalNode]);
                fScore[neighbor] = tentativeGScore + hScore;
                openSet.push([fScore[neighbor], neighbor]);
            }
        });
    }
}
```

---

## 7. 경로 역추적 (Path Reconstruction)

### 개념

알고리즘이 탐색하면서 각 노드에 "어디서 왔는가"를 `cameFrom` 딕셔너리에 기록합니다.  
목적지 도달 후, 역방향으로 체인을 따라가서 전체 경로를 복원한 뒤 뒤집습니다.

$$
\text{path} = [\text{start}, \ldots, \text{goal}] = \text{reverse}([\text{goal} \to \cdots \to \text{start}])
$$

### 코드 패턴 (`main.js:832-839`)

```js
const path = [];
let node = current;          // current == goalNode
while (cameFrom[node]) {
    path.push(node);
    node = cameFrom[node];   // 역방향으로 이동
}
path.push(startNode);
return [path.reverse(), gScore[goalNode]];
```

---

## 8. 다익스트라 vs A\* 비교

| 항목 | 다익스트라 | A\* |
|------|-----------|-----|
| 탐색 기준 | $g(v)$ 최소 | $f(v) = g(v) + h(v)$ 최소 |
| 휴리스틱 | 없음 | 하버사인 거리 |
| 탐색 방향 | 전방위 확산 | 목표 방향 집중 |
| 최적 보장 | 항상 (비음수 비용) | 허용 가능 휴리스틱 필요 |
| 탐색 노드 수 | 더 많음 | 더 적음 (일반적으로) |
| 동일 그래프 최종 비용 | 동일 최솟값 | 동일 최솟값 |

**이 프로젝트에서:** 동일한 그래프에서 실행하므로 두 알고리즘이 찾는 **누적 비용은 같고**,  
경로 문자열이 다를 경우 **동비용의 다른 최적 경로**일 수 있습니다.

---

## 9. 가중치 모델 (Edge Cost Modeling)

### 개념

실제 항공 네트워크를 단순화한 비용 모델입니다.  
모든 간선 비용을 실제 거리보다 작게 설정해 여러 경유 구간이 장거리 직항보다 저렴하게 나올 수 있도록 합니다.

$$
w(u, v) = d_{haversine}(u, v) \times 0.7
$$

| 상수 | 값 | 의미 |
|------|-----|------|
| `MAX_DIRECT_DISTANCE_KM` | 3,000 km | 간선 연결 최대 거리 |
| `EFFICIENCY_FACTOR` | 0.7 | 간선 비용 할인율 |

### 결과

- 직선 거리(대권 km)와 알고리즘 비용(units)은 **다른 척도**입니다.
- 누적 비용이 직선 거리보다 작게 나오는 것은 이 설계의 의도된 결과입니다.

---

## 10. 전체 수식 흐름 요약

```
위도·경도 (°)
    │
    ▼ × π/180
라디안 변환
    │
    ├──▶ 하버사인 → 대권 거리 (km) ──▶ × 0.7 → 간선 비용 (units)
    │                                            │
    │                                            ▼
    │                                     그래프 G = (V, E)
    │                                            │
    │         ┌──────────────────────────────────┤
    │         ▼                                  ▼
    │    A* (f = g + h)                    Dijkstra (f = g)
    │    h = 하버사인(현재, 목적지)          g = 누적 비용
    │         │                                  │
    │         └──────────┬───────────────────────┘
    │                    ▼
    │             최단 경로 (IATA 코드 리스트)
    │
    ▼ 구면→데카르트 변환
Three.js 3D 좌표 (x, y, z)
    │
    ▼ 쿼터니언 회전 + sin 높이 오프셋
대권 호 포인트 배열 → TubeGeometry → 렌더링
```
