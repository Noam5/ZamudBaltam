// Authoritative analysis engine — ports index.html classifyTrips exactly,
// runs across all historical Orzion monthly reports using the live reference data.
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const dir = __dirname;

// ---- Load authoritative reference data from the live backend snapshot ----
const live = JSON.parse(fs.readFileSync(path.join(dir,'live_state.json'),'utf8'));
const travelTable = live.travelTable;
const workingHours = live.workingHours;            // live window
const locationAliases = live.locationAliases;

// ---- helpers ported from index.html ----
function normLoc(name){ return locationAliases[name] || name; }
function timeToMin(t){ if(!t) return 0; const [h,m]=t.split(':').map(Number); return h*60+m; }
function minToHM(min){ const h=Math.floor(min/60), m=Math.round(min%60); return `${h}:${String(m).padStart(2,'0')}`; }
const HEB_DAYS=["א","ב","ג","ד","ה","ו","ש"];
function getDayOfWeek(d){ return new Date(d+'T00:00:00').getDay(); }
function routeExists(from,to){ if(from===to) return true; for(const e of travelTable){ if((e.from===from&&e.to===to)||(e.from===to&&e.to===from)) return true; } return false; }
function routeIsCheck(from,to){ for(const e of travelTable){ if((e.from===from&&e.to===to)||(e.from===to&&e.to===from)) return !!e.check; } return false; }
function lookupTravelTime(from,to,isMorning){ for(const e of travelTable){ if((e.from===from&&e.to===to)||(e.from===to&&e.to===from)) return isMorning?e.morningMin:e.afternoonMin; } return null; }
function lookupTripPrice(from,to){ for(const e of travelTable){ if((e.from===from&&e.to===to)||(e.from===to&&e.to===from)) return e.check?0:(e.price||0); } return 0; }
function getWorkingHoursForDay(dow){ if(dow===6) return null; return workingHours[dow]; }

// ---- classify (exact port, with workingHours override param) ----
function classifyTrips(trips, wh){
  const WH = wh||workingHours;
  const getWH = dow => dow===6?null:WH[dow];
  const sorted = trips.map((t,idx)=>({...t,origIdx:idx}));
  sorted.sort((a,b)=> a.date!==b.date? a.date.localeCompare(b.date): a.startTime.localeCompare(b.startTime));
  const results=[]; let cumZ=0;
  for(let i=0;i<sorted.length;i++){
    const trip=sorted[i];
    const startMin=timeToMin(trip.startTime);
    const rawEndMin=timeToMin(trip.endTime);
    const endForDur = (rawEndMin===0&&startMin>0)?1440:rawEndMin;
    const durationMin=endForDur-startMin;
    const invalidTimes=durationMin<0;
    const dow=getDayOfWeek(trip.date);
    const w=getWH(dow);
    let code='Z', missingRoute=null;
    if(w){ const s=timeToMin(w.start), e=timeToMin(w.end); if(startMin<s||rawEndMin>e) code='BML'; }
    else code='BML';
    if(code!=='BML'){
      let prevZ=null;
      for(let j=i-1;j>=0;j--){ if(results[j].date===trip.date&&results[j].code==='Z'){ prevZ=results[j]; break; } }
      if(prevZ){
        const pRaw=timeToMin(prevZ.endTime);
        const pEnd=(pRaw===0&&timeToMin(prevZ.startTime)>0)?1440:pRaw;
        const isMorning=startMin<720;
        const tMin=lookupTravelTime(prevZ.to,trip.from,isMorning);
        if(tMin!==null){ code = (pEnd-startMin+tMin>0)?'B':'Z'; }
        else missingRoute={from:prevZ.to,to:trip.from};
      }
    }
    if(code==='Z'){ cumZ+=durationMin; if(cumZ>210*60) code='B120'; }
    const price=(code==='Z')?0:lookupTripPrice(trip.from,trip.to);
    results.push({...trip, sortIdx:i, durationMin, dow, hebDay:HEB_DAYS[dow], code,
      price, isCheck:routeIsCheck(trip.from,trip.to), missingRoute, invalidTimes,
      routeKnown: routeExists(trip.from,trip.to)});
  }
  return results;
}

// ---- parseExcelDescription (exact port) ----
function parseExcelDescription(desc){
  if(!desc) return null; desc=String(desc);
  const m=desc.match(/(?:איסוף|פיזור)\s*:\s*(.+?)\s*-\s+(.+)/);
  if(!m) return null;
  let from=m[1].trim(), to=m[2].trim(), doctor='';
  const dm=to.match(/\(([^()]*)\)\s*$/);
  if(dm){ doctor=dm[1].replace(/0\d{1,2}[-\s]?\d{6,7}/g,'').replace(/[\s\-]+/g,' ').trim(); }
  to=to.replace(/\s*(\([^)]*\)\s*)+$/,'').trim().replace(/[\s\-]+$/,'').trim();
  from=from.replace(/\s*\((?:[^)]*\d{3}[^)]*|[^)]*דר'[^)]*|[^)]*ד"ר[^)]*)\)\s*$/,'').trim();
  return {from,to,doctor};
}
function parseTimeFrac(f){ if(typeof f!=='number') return ''; const t=Math.round(f*24*60); return String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0'); }
function parseSerial(s){ if(typeof s!=='number') return ''; const d=new Date((s-25569)*86400*1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`; }

// ---- locate report columns by header label ----
// Orzion reorders columns between exports (Feb-May put סוג הרכב at 7 and שעת סיום
// at 9; אוגוסט 26 swaps them), so never hardcode indices.
const HEADER_COLS = [
  ['price',    /^סה.?כ\s*ללקוח/],
  ['desc',     /^תאור$/],
  ['vehicle',  /^סוג\s*הרכב$/],
  ['endTime',  /^שעת\s*סיום$/],
  ['startTime',/^שעת\s*התחלה$/],
  ['date',     /^תאריך$/],
];
function findColumns(rows, file){
  const norm = v => String(v==null?'':v).replace(/\s+/g,' ').trim();
  for(const row of rows){
    if(!row) continue;
    const cols={};
    for(const [key,re] of HEADER_COLS){
      const i=row.findIndex(c=>re.test(norm(c)));
      if(i>=0) cols[key]=i;
    }
    if(HEADER_COLS.every(([key])=>key in cols)) return cols;
  }
  throw new Error(`${file}: no header row found (expected ${HEADER_COLS.map(([k])=>k).join(', ')})`);
}

// ---- load a monthly Orzion report ----
function loadReport(file, sheetName){
  const wb=XLSX.readFile(path.join(dir,file));
  const sn = sheetName || wb.SheetNames[0];
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,raw:true});
  const col=findColumns(rows, file);
  const trips=[];
  for(const row of rows){
    if(!row||!row[col.desc]) continue;
    const route=parseExcelDescription(String(row[col.desc]));
    if(!route) continue;
    const startTime=parseTimeFrac(row[col.startTime]);
    const endTime=parseTimeFrac(row[col.endTime]);
    const date=parseSerial(row[col.date]);
    if(!date||!startTime||!endTime) continue;
    trips.push({ date, from:normLoc(route.from), to:normLoc(route.to),
      startTime, endTime, doctor:route.doctor||'',
      rawFrom:route.from, rawTo:route.to,
      orzionPrice: (typeof row[col.price]==='number')?row[col.price]:null,
      vehicle: row[col.vehicle]||'' });
  }
  return trips;
}

const MONTHS = [
  {name:'2026-02 פברואר', file:'historical/ממוגן ירי פברואר 26 (2).xls'},
  {name:'2026-03 מרץ',    file:'historical/מרץ.xlsx'},
  {name:'2026-04 אפריל',  file:'historical/כללית ממוגן אפריל 26 (1).xls'},
  {name:'2026-05 מאי',    file:'historical/כללית ממוגן מאי 26 (2) (1).xls'},
];

// ---- run ----
const all={};
for(const M of MONTHS){ all[M.name]=loadReport(M.file); }

function summarize(label, trips, wh){
  const res=classifyTrips(trips, wh);
  const c={Z:0,B:0,BML:0,B120:0};
  let appBaltam=0, orzionTotal=0, orzionBilledTrips=0, orzionBilledSum=0, missing=0, invalid=0;
  for(const r of res){
    c[r.code]++;
    if(r.code!=='Z') appBaltam+=r.price;
    if(r.missingRoute) missing++;
    if(r.invalidTimes) invalid++;
    if(r.orzionPrice!=null){ orzionTotal+=r.orzionPrice; if(r.orzionPrice>0){orzionBilledTrips++; orzionBilledSum+=r.orzionPrice;} }
  }
  return {label, n:res.length, ...c, appBaltam, orzionTotal, orzionBilledTrips, orzionBilledSum, missing, invalid, res};
}

console.log('LIVE WORKING HOURS:', JSON.stringify(workingHours.map(w=>`${w.dayHeb} ${w.start}-${w.end}`)));
console.log('='.repeat(70));
let grand={n:0,Z:0,B:0,BML:0,B120:0,appBaltam:0,orzionBilledSum:0,orzionBilledTrips:0,missing:0};
const monthRes={};
for(const M of MONTHS){
  const s=summarize(M.name, all[M.name]);
  monthRes[M.name]=s;
  console.log(`\n${M.name}:  trips=${s.n}`);
  console.log(`  codes:  Z=${s.Z}  B=${s.B}  BML=${s.BML}  B120=${s.B120}   (Baltam trips=${s.B+s.BML+s.B120})`);
  console.log(`  app-computed Baltam ₪ = ${s.appBaltam}`);
  console.log(`  Orzion billed: ${s.orzionBilledTrips} trips, ₪${s.orzionBilledSum}  (sum of ALL col0 incl 0s = ₪${s.orzionTotal})`);
  console.log(`  data gaps: missingRoute=${s.missing}  invalidTimes=${s.invalid}`);
  for(const k of ['n','Z','B','BML','B120','appBaltam','orzionBilledSum','orzionBilledTrips','missing']) grand[k]+=s[k];
}
console.log('\n'+'='.repeat(70));
console.log('GRAND TOTAL (Feb-May, 4 months):');
console.log(`  trips=${grand.n}  Z=${grand.Z}  B=${grand.B}  BML=${grand.BML}  B120=${grand.B120}`);
console.log(`  app Baltam ₪=${grand.appBaltam}   Orzion billed ₪=${grand.orzionBilledSum} (${grand.orzionBilledTrips} trips)`);
console.log(`  avg/month: app Baltam ₪=${Math.round(grand.appBaltam/4)}  Orzion ₪=${Math.round(grand.orzionBilledSum/4)}`);
console.log(`  missingRoute trips (unpriced by app): ${grand.missing}`);

// save full results for downstream analysis
const dump={};
for(const M of MONTHS) dump[M.name]=monthRes[M.name].res;
fs.writeFileSync(path.join(dir,'classified.json'), JSON.stringify(dump,null,1));
console.log('\n[written classified.json]');
