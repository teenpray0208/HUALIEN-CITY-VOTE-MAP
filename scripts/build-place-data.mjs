import { readFile, writeFile } from 'node:fs/promises';

const geo = JSON.parse(await readFile('hualien-villages.geojson', 'utf8'));
const points = [];
const collect = value => {
  if (typeof value?.[0] === 'number') points.push(value);
  else if (Array.isArray(value)) value.forEach(collect);
};
geo.features.forEach(feature => collect(feature.geometry.coordinates));
const lons = points.map(point => point[0]);
const lats = points.map(point => point[1]);
const bbox = [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)].join(',');
const query = `[out:json][timeout:120];(
  way["highway"]["name"](${bbox});
  nwr["name"]["tourism"~"^(attraction|museum|viewpoint|gallery|artwork|zoo|theme_park)$"](${bbox});
  nwr["name"]["historic"](${bbox});
  nwr["name"]["leisure"~"^(park|garden|nature_reserve|sports_centre)$"](${bbox});
  nwr["name"]["amenity"~"^(place_of_worship|arts_centre|theatre|marketplace|library)$"](${bbox});
  nwr["name"]["amenity"~"^(school|kindergarten|college|university|hospital|clinic|townhall|community_centre|police|fire_station|post_office|bus_station|ferry_terminal|courthouse)$"](${bbox});
  nwr["name"]["office"="government"](${bbox});
  nwr["name"]["public_transport"="station"](${bbox});
  nwr["name"]["building"~"^(commercial|retail|office|hotel|public|civic|government|hospital|school|university|college|train_station|transportation|stadium)$"](${bbox});
  nwr["name"]["natural"~"^(beach|peak)$"](${bbox});
  nwr["name"]["man_made"="lighthouse"](${bbox});
  nwr["name"]["railway"="station"](${bbox});
);out center geom tags;`;

async function fetchOverpass() {
  const endpoints = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  let lastError;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Hualien-City-Vote-Map/1.0' },
        body: new URLSearchParams({ data: query })
      });
      if (!response.ok) throw new Error(`${endpoint}: HTTP ${response.status}`);
      return response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function insideRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function insidePolygon(point, polygon) {
  return insideRing(point, polygon[0]) && !polygon.slice(1).some(hole => insideRing(point, hole));
}

function insideFeature(point, feature) {
  const { type, coordinates } = feature.geometry;
  return type === 'Polygon' ? insidePolygon(point, coordinates) : coordinates.some(polygon => insidePolygon(point, polygon));
}

function elementPoints(element) {
  if (element.lat != null) return [[element.lon, element.lat]];
  if (element.geometry?.length) return element.geometry.map(point => [point.lon, point.lat]);
  if (element.center) return [[element.center.lon, element.center.lat]];
  return [];
}

function attractionType(tags) {
  if (tags.tourism === 'museum') return '博物館';
  if (tags.tourism === 'viewpoint') return '觀景點';
  if (tags.tourism === 'gallery') return '藝文空間';
  if (tags.tourism === 'artwork') return '公共藝術';
  if (tags.historic) return '歷史地標';
  if (tags.leisure === 'park') return '公園';
  if (tags.leisure === 'garden') return '園區';
  if (tags.leisure === 'sports_centre') return '運動場館';
  if (tags.amenity === 'place_of_worship') return '宗教景點';
  if (tags.amenity === 'library') return '圖書館';
  if (tags.amenity === 'marketplace') return '市場';
  if (tags.amenity === 'theatre') return '劇場';
  if (tags.natural === 'beach') return '海灘';
  if (tags.natural === 'peak') return '自然景點';
  if (tags.man_made === 'lighthouse') return '燈塔';
  return '景點';
}

function isInfrastructure(tags) {
  return tags.railway === 'station' || tags.public_transport === 'station' || tags.office === 'government' || /^(library|school|kindergarten|college|university|hospital|clinic|townhall|community_centre|police|fire_station|post_office|bus_station|ferry_terminal|courthouse)$/.test(tags.amenity || '');
}

function infrastructureType(tags) {
  if (tags.railway === 'station' || tags.public_transport === 'station' || /^(bus_station|ferry_terminal)$/.test(tags.amenity || '')) return '交通建設';
  if (/^(school|kindergarten|college|university)$/.test(tags.amenity || '')) return '教育設施';
  if (/^(hospital|clinic)$/.test(tags.amenity || '')) return '醫療設施';
  if (tags.amenity === 'library') return '文化設施';
  if (tags.amenity === 'community_centre') return '社區設施';
  if (/^(police|fire_station)$/.test(tags.amenity || '')) return '警消設施';
  if (tags.amenity === 'post_office') return '郵政設施';
  if (tags.amenity === 'courthouse') return '司法機關';
  return '政府機關';
}

function buildingType(tags) {
  if (tags.building === 'hotel') return '飯店建築';
  if (/^(commercial|retail)$/.test(tags.building || '')) return '商業建築';
  if (tags.building === 'office') return '辦公建築';
  if (/^(school|university|college)$/.test(tags.building || '')) return '校園建築';
  if (tags.building === 'hospital') return '醫療建築';
  if (/^(train_station|transportation)$/.test(tags.building || '')) return '交通建築';
  if (tags.building === 'stadium') return '體育建築';
  return '公共建築';
}

function isMajorBuilding(tags) {
  return /^(commercial|retail|office|hotel|public|civic|government|hospital|school|university|college|train_station|transportation|stadium)$/.test(tags.building || '');
}

const osm = await fetchOverpass();
const roads = osm.elements.filter(element => element.tags?.highway && element.tags?.name);
const namedPlaces = osm.elements.filter(element => !element.tags?.highway && element.tags?.name);
const attractions = namedPlaces.filter(element => !isInfrastructure(element.tags) && !isMajorBuilding(element.tags));
const infrastructure = namedPlaces.filter(element => isInfrastructure(element.tags));
const buildings = namedPlaces.filter(element => isMajorBuilding(element.tags));
const result = {};

for (const feature of geo.features) {
  const name = feature.properties.VILL;
  const roadNames = new Set();
  const places = new Map();
  const facilities = new Map();
  const majorBuildings = new Map();
  for (const road of roads) {
    if (elementPoints(road).some(point => insideFeature(point, feature))) roadNames.add(road.tags.name);
  }
  for (const attraction of attractions) {
    if (elementPoints(attraction).some(point => insideFeature(point, feature))) {
      const placeName = attraction.tags.name;
      if (!places.has(placeName)) places.set(placeName, attractionType(attraction.tags));
    }
  }
  for (const facility of infrastructure) {
    if (elementPoints(facility).some(point => insideFeature(point, feature))) {
      const facilityName = facility.tags.name;
      if (!facilities.has(facilityName)) facilities.set(facilityName, infrastructureType(facility.tags));
    }
  }
  const usedNames = new Set([...places.keys(), ...facilities.keys()]);
  for (const building of buildings) {
    if (!usedNames.has(building.tags.name) && elementPoints(building).some(point => insideFeature(point, feature))) {
      majorBuildings.set(building.tags.name, buildingType(building.tags));
    }
  }
  result[name] = {
    roads: [...roadNames].sort((a, b) => a.localeCompare(b, 'zh-Hant')),
    attractions: [...places].map(([placeName, type]) => ({ name: placeName, type })).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')),
    infrastructure: [...facilities].map(([facilityName, type]) => ({ name: facilityName, type })).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')),
    buildings: [...majorBuildings].map(([buildingName, type]) => ({ name: buildingName, type })).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
  };
}

await writeFile('place-data.json', `${JSON.stringify({
  meta: {
    source: 'OpenStreetMap contributors',
    sourceUrl: 'https://www.openstreetmap.org/copyright',
    generatedAt: new Date().toISOString(),
    note: '道路、景點、公共設施及主要建物依公開圖資座標和花蓮市里界進行空間比對；跨里道路可能列於多個里。'
  },
  villages: result
})}\n`, 'utf8');

const counts = Object.values(result);
console.log(`Wrote place-data.json: ${counts.reduce((sum, row) => sum + row.roads.length, 0)} village-road links, ${counts.reduce((sum, row) => sum + row.attractions.length, 0)} village-attraction links, ${counts.reduce((sum, row) => sum + row.infrastructure.length, 0)} village-infrastructure links, ${counts.reduce((sum, row) => sum + row.buildings.length, 0)} village-building links.`);
