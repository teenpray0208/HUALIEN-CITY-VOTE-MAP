import { writeFile } from 'node:fs/promises';

const API = 'https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getPage(month, page, attempt = 1) {
  const response = await fetch(`${API}/${month}?page=${page}`, {
    headers: { 'user-agent': 'Hualien-City-Vote-Map/1.0' }
  });
  if (!response.ok) throw new Error(`${month} page ${page}: HTTP ${response.status}`);
  const body = await response.json();
  if (body.responseCode !== 'OD-0101-S') {
    if (attempt < 5) {
      await sleep(attempt * 1800);
      return getPage(month, page, attempt + 1);
    }
    throw new Error(`${month} page ${page}: ${body.responseCode} ${body.responseMessage}`);
  }
  return body;
}

async function getMonth(month) {
  const first = await getPage(month, 1);
  const rows = [...first.responseData];
  for (let page = 2; page <= Number(first.totalPage); page += 1) {
    await sleep(650);
    rows.push(...(await getPage(month, page)).responseData);
  }
  const city = rows.filter(row => row.site_id === '花蓮縣花蓮市');
  if (city.length !== 44) throw new Error(`${month}: expected 44 Hualien City villages, got ${city.length}`);
  return Object.fromEntries(city.map(row => {
    const ages = Array.from({ length: 101 }, (_, age) => {
      const suffix = age === 100 ? '100up' : String(age).padStart(3, '0');
      return [Number(row[`people_age_${suffix}_m`]), Number(row[`people_age_${suffix}_f`])];
    });
    return [row.village, {
      total: Number(row.people_total),
      male: Number(row.people_total_m),
      female: Number(row.people_total_f),
      ages
    }];
  }));
}

async function latestAvailable(months) {
  for (const month of months) {
    try {
      return { month, villages: await getMonth(month) };
    } catch (error) {
      if (month === months.at(-1)) throw error;
      console.warn(`${month} unavailable; trying earlier month.`);
      await sleep(1800);
    }
  }
}

const sources = {
  2022: await latestAvailable(['11111']),
  2024: await latestAvailable(['11301']),
  2026: await latestAvailable(['11508', '11507', '11506'])
};

const output = {
  meta: {
    source: '內政部戶政司「村里戶數、單一年齡人口（新增區域代碼）」ODRP014',
    api: API,
    notes: {
      2022: '2022年11月底戶籍人口，為距11月26日投票日最近的官方月資料。',
      2024: '2024年1月底戶籍人口，為1月13日投票當月的官方月資料。',
      2026: `2026年${Number(sources[2026].month.slice(3))}月底最新戶籍人口；11月28日投票日尚未到來，非投票日實際值。`
    },
    months: Object.fromEntries(Object.entries(sources).map(([year, value]) => [year, value.month]))
  },
  years: Object.fromEntries(Object.entries(sources).map(([year, value]) => [year, value.villages]))
};

await writeFile('population-data.json', `${JSON.stringify(output)}\n`, 'utf8');
console.log(`Wrote population-data.json: ${Object.keys(output.years[2022]).length} villages × 3 years.`);
