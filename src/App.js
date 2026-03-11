import { useState, useMemo, useRef, useEffect } from "react";

// ─── TAX ENGINE ───────────────────────────────────────────────────────────────
const FED_BRACKETS = {
  single:  [[11600,0.10],[47150,0.12],[100525,0.22],[191950,0.24],[243725,0.32],[609350,0.35],[Infinity,0.37]],
  married: [[23200,0.10],[94300,0.12],[201050,0.22],[383900,0.24],[487450,0.32],[731200,0.35],[Infinity,0.37]],
  hoh:     [[16550,0.10],[63100,0.12],[100500,0.22],[191950,0.24],[243700,0.32],[609350,0.35],[Infinity,0.37]],
};
const STANDARD_DEDUCTION = { single:14600, married:29200, hoh:21900 };
function calcFica(a) { return Math.min(a,168600)*0.062 + a*0.0145; }
function calcFederalTax(annual, status) {
  const brackets = FED_BRACKETS[status]||FED_BRACKETS.single;
  const taxable  = Math.max(0, annual-(STANDARD_DEDUCTION[status]||14600));
  let tax=0,prev=0;
  for(const [cap,rate] of brackets){ if(taxable<=prev)break; tax+=(Math.min(taxable,cap)-prev)*rate; prev=cap; }
  return tax;
}
const STATE_RATES = {
  AL:0.050,AK:0.000,AZ:0.025,AR:0.047,CA:0.093,CO:0.044,CT:0.065,DE:0.066,
  FL:0.000,GA:0.055,HI:0.110,ID:0.058,IL:0.049,IN:0.031,IA:0.057,KS:0.057,
  KY:0.045,LA:0.042,ME:0.075,MD:0.057,MA:0.050,MI:0.043,MN:0.098,MS:0.047,
  MO:0.049,MT:0.069,NE:0.064,NV:0.000,NH:0.000,NJ:0.108,NM:0.059,NY:0.109,
  NC:0.045,ND:0.025,OH:0.040,OK:0.045,OR:0.099,PA:0.031,RI:0.060,SC:0.065,
  SD:0.000,TN:0.000,TX:0.000,UT:0.046,VT:0.066,VA:0.058,WA:0.000,WV:0.065,
  WI:0.075,WY:0.000,DC:0.085,
};
const STATE_NAMES = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",
  CO:"Colorado",CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",
  HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",
  KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",
  MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",
  NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",
  NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",
  OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",
  SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",
  VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",
  DC:"Washington DC",
};
function calcNetMonthly(annualGross, status, stateCode) {
  const fed  = calcFederalTax(annualGross, status);
  const fica = calcFica(annualGross);
  const st   = Math.max(0, annualGross-(STANDARD_DEDUCTION[status]||14600))*(STATE_RATES[stateCode]??0);
  const net  = annualGross - fed - fica - st;
  return {
    net: net/12,
    effectiveRate: annualGross>0 ? (annualGross-net)/annualGross : 0,
    breakdown:{ federal:fed/12, fica:fica/12, state:st/12 },
  };
}

// ─── CALC ENGINE ──────────────────────────────────────────────────────────────
function calcLoanPayment(principal, annualRate, termYears) {
  if(principal<=0) return 0;
  if(annualRate===0) return principal/(termYears*12);
  const r=annualRate/100/12, n=termYears*12;
  return (principal*r*Math.pow(1+r,n))/(Math.pow(1+r,n)-1);
}
function calcHomeCost(price, payment, annualTax, annualIns, hoa=0) {
  return payment + annualTax/12 + annualIns/12 + hoa;
}
function solvePriceForRatio(ratio, net, down, rate, term, tax) {
  const target=net*ratio; let lo=5000,hi=8_000_000;
  for(let i=0;i<80;i++){
    const mid=(lo+hi)/2, mp=calcLoanPayment(Math.max(0,mid-down),rate,term);
    if(calcHomeCost(mid,mp,tax,mid*0.0035)<target) lo=mid; else hi=mid;
  }
  return Math.round((lo+hi)/2);
}

function getBaselineExpenses(b) {
  if(b.expenseMode==="simple")
    return { total:b.simpleTotal, housing:b.currentHousing };
  const housing=b.currentHousing;
  const rest=b.carPayment+b.otherDebts+b.utilities+b.groceries+b.subscriptions+b.otherLiving;
  return { total:housing+rest, housing };
}

function getBaselineIncome(b) {
  const primary = b.incomeMode==="gross"
    ? calcNetMonthly(b.annualGross, b.filingStatus, b.state)
    : { net:b.netIncome, effectiveRate:0, breakdown:{federal:0,fica:0,state:0} };
  if(!b.showPartnerIncome) return primary;
  const partnerNet = b.partnerIncomeMode==="gross"
    ? calcNetMonthly(b.partnerAnnualGross, "single", b.state).net
    : b.partnerNetIncome;
  return { ...primary, net: primary.net + partnerNet, partnerNet };
}

// ── HOME scenario ──
function calcHome(b, sc) {
  const taxResult = getBaselineIncome(b);
  const netIncome = taxResult.net;
  const { total:baselineTotal, housing:baselineHousing } = getBaselineExpenses(b);
  const baselineSurplus = netIncome - baselineTotal;

  const insurance  = sc.useDefaultIns   ? sc.homePrice*0.0035 : sc.annualInsurance;
  const closing    = sc.useDefaultClose ? sc.homePrice*0.03   : sc.closingCosts;
  const loan       = Math.max(0, sc.homePrice-sc.downPayment);
  const mortgage   = calcLoanPayment(loan, sc.interestRate, sc.loanTerm);
  const downPct    = sc.homePrice > 0 ? sc.downPayment / sc.homePrice : 1;
  const pmiApplies = downPct < 0.20 && loan > 0;
  const pmiRate    = sc.useDefaultPmi ? 0.0085 : (sc.pmiRate / 100);
  const pmiMonthly = pmiApplies ? (loan * pmiRate) / 12 : 0;
  const hoaMonthly = sc.hoaMonthly || 0;
  const newHousing = calcHomeCost(sc.homePrice, mortgage, sc.annualTax, insurance, hoaMonthly) + pmiMonthly;
  const cashNeeded = sc.downPayment + closing;
  const remainingSavings = b.savings - cashNeeded;
  const newTotal   = baselineTotal - baselineHousing + newHousing;
  const newSurplus = netIncome - newTotal;
  const deltaSurplus = newSurplus - baselineSurplus;
  const housingRatio = netIncome>0 ? newHousing/netIncome : 0;
  const runway = newTotal>0 ? Math.max(0,remainingSavings)/newTotal : 0;
  const ratioSafe = housingRatio<=0.28, ratioRisky = housingRatio>0.35;
  const runwayRisky = runway<3;
  const discretionaryMin = netIncome * 0.30; // 30% of take-home should remain discretionary
  const surplusRisky = newSurplus < (discretionaryMin * 0.5); // below 15% of take-home = risky
  const surplusStretch = newSurplus < discretionaryMin; // below 30% of take-home = stretch
  const risk = newSurplus<0||ratioRisky||runwayRisky||surplusRisky?"RISKY":ratioSafe&&!surplusStretch?"SAFE":"STRETCH";
  const comfortPrice = solvePriceForRatio(0.28,netIncome,sc.downPayment,sc.interestRate,sc.loanTerm,sc.annualTax);
  const stretchPrice = solvePriceForRatio(0.35,netIncome,sc.downPayment,sc.interestRate,sc.loanTerm,sc.annualTax);
  return {
    type:"home", netIncome, taxResult, baselineTotal, baselineSurplus,
    scenarioCost:newHousing, newTotal, newSurplus, deltaSurplus,
    ratio:housingRatio, cashNeeded, remainingSavings, runway, risk,
    mortgage, insurance, closing, comfortPrice, stretchPrice, pmiMonthly, pmiApplies, hoaMonthly,
    label:"New Housing Cost", prevLabel:`was ${fmt(baselineHousing)}/mo`,
  };
}

// ── CAR scenario ──
function calcCar(b, sc) {
  const taxResult = getBaselineIncome(b);
  const netIncome = taxResult.net;
  const { total:baselineTotal } = getBaselineExpenses(b);
  const baselineSurplus = netIncome - baselineTotal;

  // monthly payment
  let monthly;
  if(sc.carMode==="lease") {
    monthly = sc.leaseMonthly;
  } else if(sc.useKnownPayment) {
    monthly = sc.knownPayment;
  } else {
    const loan = Math.max(0,(sc.msrp-sc.tradeIn)-sc.downPayment);
    monthly = calcLoanPayment(loan, sc.carRate, sc.carTerm);
  }
  const insuranceDelta = sc.insuranceDelta; // monthly increase
  const totalNewCarCost = monthly + insuranceDelta;

  // cash upfront
  const cashNeeded = sc.carMode==="lease"
    ? sc.leaseDownPayment
    : sc.downPayment + (sc.carMode==="buy" ? 0 : 0);
  const remainingSavings = b.savings - cashNeeded;

  const newTotal   = baselineTotal + totalNewCarCost; // adds to existing expenses
  const newSurplus = netIncome - newTotal;
  const deltaSurplus = newSurplus - baselineSurplus;
  const ratio = netIncome>0 ? totalNewCarCost/netIncome : 0;
  const runway = newTotal>0 ? Math.max(0,remainingSavings)/newTotal : 0;
  const risk = ratio<=0.10&&runway>=6&&newSurplus>0?"SAFE":ratio>0.15||runway<3||newSurplus<0?"RISKY":"STRETCH";

  return {
    type:"car", netIncome, taxResult, baselineTotal, baselineSurplus,
    scenarioCost:totalNewCarCost, newTotal, newSurplus, deltaSurplus,
    ratio, cashNeeded, remainingSavings, runway, risk,
    monthly, insuranceDelta,
    label:"New Car Cost/mo", prevLabel:"added to budget",
  };
}

// ── JOB scenario ──
function calcJob(b, sc) {
  const oldTaxResult = getBaselineIncome(b);
  const oldNet = oldTaxResult.net;
  const newTaxResult = calcNetMonthly(sc.newAnnualSalary, b.filingStatus, b.state);
  const newNet = newTaxResult.net;

  const { total:baselineTotal } = getBaselineExpenses(b);
  const baselineSurplus = oldNet - baselineTotal;

  // one-time costs
  const oneTimeCosts = (sc.relocationCosts||0);
  const oneTimeIncome = (sc.signingBonus||0);
  const netOneTime = oneTimeIncome - oneTimeCosts;

  // recurring monthly delta
  const commuteDelta = (sc.newCommuteCost||0) - (sc.oldCommuteCost||0);
  const benefitsDelta = (sc.benefitsCost||0); // monthly cost of new/lost benefits

  const newTotal   = baselineTotal + commuteDelta + benefitsDelta;
  const newSurplus = newNet - newTotal;
  const deltaSurplus = newSurplus - baselineSurplus;
  const salaryDelta = newNet - oldNet;

  // break-even: how many months until one-time costs recovered by monthly gain
  const monthlyGain = newSurplus - baselineSurplus;
  const breakEven = netOneTime<0 && monthlyGain>0 ? Math.ceil(Math.abs(netOneTime)/monthlyGain) : netOneTime>=0 ? 0 : null;

  const remainingSavings = b.savings + netOneTime;
  const runway = newTotal>0 ? Math.max(0,remainingSavings)/newTotal : 0;
  const ratio = newNet>0 ? newTotal/newNet : 0; // total expense ratio

  const risk = deltaSurplus>=0&&runway>=6?"SAFE":deltaSurplus<0||runway<3?"RISKY":"STRETCH";

  return {
    type:"job", netIncome:newNet, oldNet, newTaxResult, oldTaxResult,
    baselineTotal, baselineSurplus,
    scenarioCost:commuteDelta+benefitsDelta,
    newTotal, newSurplus, deltaSurplus, salaryDelta,
    ratio, cashNeeded:0, remainingSavings, runway, risk,
    commuteDelta, benefitsDelta, netOneTime, breakEven,
    label:"Monthly Expense Change", prevLabel:"commute + benefits delta",
  };
}

// ── APARTMENT scenario ──
function calcApartment(b, sc) {
  const taxResult = getBaselineIncome(b);
  const netIncome = taxResult.net;
  const { total:baselineTotal, housing:baselineHousing } = getBaselineExpenses(b);
  const baselineSurplus = netIncome - baselineTotal;

  const newRent    = sc.newRent;
  const cashNeeded = sc.securityDeposit + sc.moveCosts;
  const remainingSavings = b.savings - cashNeeded;
  const newTotal   = baselineTotal - baselineHousing + newRent;
  const newSurplus = netIncome - newTotal;
  const deltaSurplus = newSurplus - baselineSurplus;
  const ratio = netIncome>0 ? newRent/netIncome : 0;
  const runway = newTotal>0 ? Math.max(0,remainingSavings)/newTotal : 0;
  const risk = ratio<=0.28&&runway>=6&&newSurplus>0?"SAFE":ratio>0.35||runway<3||newSurplus<0?"RISKY":"STRETCH";

  return {
    type:"apt", netIncome, taxResult, baselineTotal, baselineSurplus,
    scenarioCost:newRent, newTotal, newSurplus, deltaSurplus,
    ratio, cashNeeded, remainingSavings, runway, risk,
    label:"New Rent", prevLabel:`was ${fmt(baselineHousing)}/mo`,
  };
}

// ── DAYCARE scenario ──
function calcDaycare(b, sc) {
  const taxResult = getBaselineIncome(b);
  const netIncome = taxResult.net;
  const { total:baselineTotal } = getBaselineExpenses(b);
  const baselineSurplus = netIncome - baselineTotal;

  const numChildren   = sc.daycareChildren || 1;
  const costPerChild  = sc.daycareCostPerChild || 0;
  const fsaBenefit    = (sc.daycareFSA || 0) / 12; // annual FSA → monthly
  const lostIncome    = sc.daycareLostIncome || 0;  // monthly lost income

  const grossDaycareCost = costPerChild * numChildren;
  const netDaycareCost   = Math.max(0, grossDaycareCost - fsaBenefit);
  const newTotal         = baselineTotal + netDaycareCost;
  const newNet           = netIncome - lostIncome;
  const newSurplus       = newNet - newTotal;
  const deltaSurplus     = newSurplus - baselineSurplus;
  const runway           = newTotal > 0 ? Math.max(0, b.savings) / newTotal : 0;
  const risk             = newSurplus < 0 || runway < 3 ? "RISKY" : newSurplus > 500 && runway >= 6 ? "SAFE" : "STRETCH";

  // Break-even: is it worth both parents working?
  const worthWorking = lostIncome > 0 ? lostIncome > netDaycareCost : null;

  return {
    type:"daycare", netIncome:newNet, taxResult, baselineTotal, baselineSurplus,
    scenarioCost:netDaycareCost, newTotal, newSurplus, deltaSurplus,
    grossDaycareCost, netDaycareCost, fsaBenefit, lostIncome, worthWorking,
    runway, risk, ratio: newTotal > 0 ? netDaycareCost / newNet : 0,
    cashNeeded:0, remainingSavings:b.savings,
    label:"Monthly Daycare Cost", prevLabel:`${numChildren} child${numChildren>1?"ren":""}`,
  };
}

// ── SAVINGS GOAL scenario ──
function calcSavings(b, sc) {
  const taxResult = getBaselineIncome(b);
  const netIncome = taxResult.net;
  const { total:baselineTotal } = getBaselineExpenses(b);
  const baselineSurplus = netIncome - baselineTotal;

  const goal        = sc.savingsGoal || 0;
  const alreadySaved = sc.savingsAlreadySaved || 0;
  const remaining   = Math.max(0, goal - alreadySaved);
  const targetMonths = sc.savingsTargetMonths || 0; // 0 = not set
  const monthlySurplus = Math.max(0, baselineSurplus);

  // If target months set → required monthly
  const requiredMonthly = targetMonths > 0 ? remaining / targetMonths : null;
  const feasible = requiredMonthly !== null ? requiredMonthly <= monthlySurplus : null;

  // Risk logic — no baseline = UNKNOWN; use moderate pace (50%) for no-target verdict
  const hasIncome = netIncome > 0 || baselineTotal > 0;
  const noBaseline = !hasIncome;

  const moderateMonths = monthlySurplus > 0 ? Math.ceil(remaining / (monthlySurplus * 0.5)) : null;

  // Timeline options — only when surplus > 0
  const timelines = remaining > 0 && monthlySurplus > 0 ? [
    { label:"Aggressive", months: Math.ceil(remaining / (monthlySurplus * 0.8)), pct:0.8 },
    { label:"Moderate",   months: Math.ceil(remaining / (monthlySurplus * 0.5)), pct:0.5 },
    { label:"Relaxed",    months: Math.ceil(remaining / (monthlySurplus * 0.3)), pct:0.3 },
  ].map(t => ({ ...t, monthly: monthlySurplus * t.pct })) : [];

  // At-current-surplus timeline
  const atSurplusMonths = monthlySurplus > 0 ? Math.ceil(remaining / monthlySurplus) : null;

  const risk = noBaseline ? "UNKNOWN"
    : targetMonths > 0 && requiredMonthly !== null
      ? (requiredMonthly <= monthlySurplus * 0.5 ? "SAFE" : requiredMonthly <= monthlySurplus ? "STRETCH" : "RISKY")
      : moderateMonths === null ? "RISKY"
      : moderateMonths <= 36 ? "SAFE"
      : moderateMonths <= 60 ? "STRETCH"
      : "RISKY";

  return {
    type:"savings", netIncome, taxResult, baselineTotal, baselineSurplus,
    goal, alreadySaved, remaining, targetMonths, requiredMonthly,
    monthlySurplus, feasible, timelines, atSurplusMonths, noBaseline, moderateMonths,
    newSurplus: requiredMonthly ? baselineSurplus - requiredMonthly : baselineSurplus,
    newTotal: baselineTotal + (requiredMonthly || 0),
    deltaSurplus: requiredMonthly ? -requiredMonthly : 0,
    ratio: goal > 0 ? (requiredMonthly || 0) / (netIncome || 1) : 0,
    cashNeeded:0, remainingSavings: b.savings,
    runway: baselineTotal > 0 ? b.savings / baselineTotal : 0,
    risk, scenarioCost: requiredMonthly || 0,
    label:"Monthly Savings", prevLabel:`goal: ${fmt(goal)}`,
  };
}

function isReady(b, sc) {
  const hasIncome = b.annualGross > 0 || b.netIncome > 0;
  if(sc.type === "home")    return hasIncome && sc.homePrice > 0;
  if(sc.type === "car")     return sc.carMode === "lease" ? sc.leaseMonthly > 0 : (sc.useKnownPayment ? sc.knownPayment > 0 : sc.msrp > 0);
  if(sc.type === "job")     return sc.newAnnualSalary > 0;
  if(sc.type === "apt")     return hasIncome && sc.newRent > 0;
  if(sc.type === "daycare") return hasIncome && (sc.daycareCostPerChild > 0);
  if(sc.type === "savings") return sc.savingsGoal > 0;
  return false;
}

function isScenarioReady(sc) {
  if(sc.type === "home")    return sc.homePrice > 0;
  if(sc.type === "car")     return sc.carMode === "lease" ? sc.leaseMonthly > 0 : (sc.useKnownPayment ? sc.knownPayment > 0 : sc.msrp > 0);
  if(sc.type === "job")     return sc.newAnnualSalary > 0;
  if(sc.type === "apt")     return sc.newRent > 0;
  if(sc.type === "daycare") return sc.daycareCostPerChild > 0;
  if(sc.type === "savings") return sc.savingsGoal > 0;
  return false;
}

function runCalcs(b, sc) {
  try {
    if(sc.type==="home")    return calcHome(b,sc);
    if(sc.type==="car")     return calcCar(b,sc);
    if(sc.type==="job")     return calcJob(b,sc);
    if(sc.type==="apt")     return calcApartment(b,sc);
    if(sc.type==="daycare") return calcDaycare(b,sc);
    if(sc.type==="savings") return calcSavings(b,sc);
  } catch(e) { /* fall through */ }
  return calcHome(b,sc);
}

// ─── FORMAT ───────────────────────────────────────────────────────────────────
const fmt  = (n,d=0) => n==null?"—":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:d}).format(n);
const pct  = n => n==null?"—":(n*100).toFixed(1)+"%";
const mths = n => n==null?"—":n>99?"99+ mo":n.toFixed(1)+" mo";

// ─── ANIMATED NUMBER HOOK ────────────────────────────────────────────────────
function useAnimatedNumber(target, duration=600) {
  const [display, setDisplay] = useState(target);
  const prev = useRef(target);
  useEffect(() => {
    const start = prev.current;
    const diff  = target - start;
    if(diff === 0) return;
    const t0 = performance.now();
    let raf;
    const step = now => {
      const p = Math.min(1, (now - t0) / duration);
      const ease = 1 - Math.pow(1 - p, 3); // cubic ease-out
      setDisplay(start + diff * ease);
      if(p < 1) raf = requestAnimationFrame(step);
      else { setDisplay(target); prev.current = target; }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return display;
}

// ─── CONFETTI ────────────────────────────────────────────────────────────────
function Confetti({ active }) {
  const canvasRef = useRef();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if(!active) return;
    setVisible(true);
    const canvas = canvasRef.current;
    if(!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    const DURATION = 2200; // ms before pieces stop falling
    const FADE_START = 1600;
    const pieces = Array.from({length:55}, () => ({
      x: Math.random() * canvas.width,
      y: -10 - Math.random() * 80,
      r: 3 + Math.random() * 4,
      d: Math.random() * 4 + 1.5,
      color: ["#34D399","#6EE7B7","#A7F3D0","#FCD34D","#818CF8","#C4B5FD"][Math.floor(Math.random()*6)],
      tilt: 0, tiltAngle: 0, tiltSpeed: Math.random() * 0.08 + 0.03,
    }));
    const t0 = performance.now();
    let frame;
    const draw = now => {
      const elapsed = now - t0;
      if(elapsed > DURATION) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        setVisible(false);
        return;
      }
      const alpha = elapsed > FADE_START
        ? 1 - (elapsed - FADE_START) / (DURATION - FADE_START)
        : 1;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = alpha;
      pieces.forEach(p => {
        p.tiltAngle += p.tiltSpeed;
        p.y += p.d;
        p.tilt = Math.sin(p.tiltAngle) * 10;
        // once off bottom, don't recycle — let them fall out
        ctx.beginPath();
        ctx.lineWidth = p.r;
        ctx.strokeStyle = p.color;
        ctx.moveTo(p.x + p.tilt + p.r/4, p.y);
        ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r/4);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [active]);

  if(!active && !visible) return null;
  return <canvas ref={canvasRef} style={{ position:"absolute",top:0,left:0,width:"100%",height:"100%",pointerEvents:"none",borderRadius:18,opacity:visible?1:0,transition:"opacity 0.3s" }} />;
}

// ─── THEME ────────────────────────────────────────────────────────────────────
const THEME = {
  baseline:{ solid:"#D97706",light:"#FFFBEB",border:"#FCD34D",text:"#fff",dim:"#92400E",glow:"#D9770644",emoji:"📋",label:"Baseline" },
  scenario:{ solid:"#4338CA",light:"#EEF2FF",border:"#A5B4FC",text:"#fff",dim:"#312E81",glow:"#4338CA44",emoji:"🔍",label:"Scenario" },
  results: { solid:"#059669",light:"#ECFDF5",border:"#6EE7B7",text:"#fff",dim:"#064E3B",glow:"#05966944",emoji:"📊",label:"Results"  },
};
const TABS = ["baseline","scenario","results"];
const RISK_CFG = {
  SAFE:    { label:"Safe",    color:"#166534", bg:"#dcfce7", border:"#86efac", icon:"✦" },
  STRETCH: { label:"Stretch", color:"#92400e", bg:"#fef9c3", border:"#fde047", icon:"◈" },
  RISKY:   { label:"Risky",   color:"#991b1b", bg:"#fee2e2", border:"#fca5a5", icon:"◆" },
  UNKNOWN: { label:"Add Income", color:"#374151", bg:"#F3F4F6", border:"#D1D5DB", icon:"◇" },
};
const SCENARIO_META = {
  home:    { emoji:"🏡", label:"Buy a Home",       color:"#4338CA" },
  car:     { emoji:"🚗", label:"Buy / Lease a Car", color:"#0891B2" },
  job:     { emoji:"💼", label:"New Job",           color:"#7C3AED" },
  apt:     { emoji:"🏢", label:"New Apartment",     color:"#0F766E" },
  daycare: { emoji:"👶", label:"Daycare",           color:"#DB2777" },
  savings: { emoji:"🎯", label:"Savings Goal",      color:"#D97706" },
};

// ─── SHARED UI ────────────────────────────────────────────────────────────────
function Field({ label, hint, optional, children }) {
  return (
    <div style={{ marginBottom:16 }}>
      <div style={{ display:"flex",justifyContent:"space-between",marginBottom:6 }}>
        <span style={{ fontSize:11,fontWeight:800,letterSpacing:"0.07em",textTransform:"uppercase",color:"#6B7280" }}>{label}</span>
        {optional&&<span style={{ fontSize:10.5,color:"#C4C4C4",fontStyle:"italic" }}>optional</span>}
        {hint    &&<span style={{ fontSize:10.5,color:"#C4C4C4" }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}
function Num({ value, onChange, prefix, suffix, accentColor }) {
  const [f, setF] = useState(false);
  const [raw, setRaw] = useState(value > 0 ? String(value) : "");

  // Keep raw in sync when value changes externally (e.g. reset, CSV import)
  useEffect(() => {
    if(!f) setRaw(value > 0 ? Number(value).toLocaleString("en-US") : "");
  }, [value, f]);

  const handleChange = e => {
    const str = e.target.value.replace(/[^0-9.]/g, ""); // strip non-numeric
    setRaw(str);
    onChange(parseFloat(str) || 0);
  };

  const handleFocus = () => {
    setF(true);
    // Show plain number while editing
    setRaw(value > 0 ? String(value) : "");
  };

  const handleBlur = () => {
    setF(false);
    // Format with commas on blur
    const n = parseFloat(raw) || 0;
    setRaw(n > 0 ? n.toLocaleString("en-US") : "");
    onChange(n);
  };

  return (
    <div style={{ position:"relative" }}>
      {prefix&&<span style={{ position:"absolute",left:13,top:"50%",transform:"translateY(-50%)",fontSize:13,color:"#AAA",pointerEvents:"none",fontFamily:"monospace" }}>{prefix}</span>}
      <input type="text" inputMode="decimal" value={raw} placeholder="0"
        onChange={handleChange} onFocus={handleFocus} onBlur={handleBlur}
        style={{ width:"100%",boxSizing:"border-box",padding:`12px ${suffix?44:13}px 12px ${prefix?30:13}px`,
          border:`2px solid ${f?(accentColor||"#6B7280"):"#E5E7EB"}`,borderRadius:11,fontSize:15,
          fontFamily:"monospace",fontWeight:700,color:"#111",background:f?"#fff":"#F9FAFB",
          outline:"none",transition:"all 0.14s",boxShadow:f?`0 0 0 3px ${(accentColor||"#6B7280")}22`:"none" }} />
      {suffix&&<span style={{ position:"absolute",right:13,top:"50%",transform:"translateY(-50%)",fontSize:11,color:"#C4C4C4",pointerEvents:"none" }}>{suffix}</span>}
    </div>
  );
}
function SelInput({ value, onChange, children, accentColor }) {
  const [f,setF]=useState(false);
  return (
    <select value={value} onChange={e=>onChange(e.target.value)} onFocus={()=>setF(true)} onBlur={()=>setF(false)}
      style={{ width:"100%",padding:"12px 36px 12px 13px",border:`2px solid ${f?(accentColor||"#6B7280"):"#E5E7EB"}`,
        borderRadius:11,fontSize:14,fontFamily:"inherit",fontWeight:600,color:"#111",
        background:f?"#fff":"#F9FAFB",outline:"none",cursor:"pointer",transition:"all 0.14s",
        boxShadow:f?`0 0 0 3px ${(accentColor||"#6B7280")}22`:"none",appearance:"none",
        backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23999' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
        backgroundRepeat:"no-repeat",backgroundPosition:"right 13px center" }}
    >{children}</select>
  );
}
function Pill({ value, options, onChange, accentColor }) {
  return (
    <div style={{ display:"inline-flex",background:"#F3F4F6",borderRadius:10,padding:3,gap:2 }}>
      {options.map(o=>{
        const a=value===o.value;
        return <button key={o.value} onClick={()=>onChange(o.value)} style={{
          padding:"6px 14px",borderRadius:8,border:"none",cursor:"pointer",fontSize:12,fontWeight:800,
          transition:"all 0.14s",background:a?(accentColor||"#111"):"transparent",
          color:a?"#fff":"#9CA3AF",boxShadow:a?"0 1px 4px rgba(0,0,0,0.18)":"none" }}>{o.label}</button>;
      })}
    </div>
  );
}
function Divider({ label }) {
  return (
    <div style={{ display:"flex",alignItems:"center",gap:10,margin:"20px 0 16px" }}>
      <div style={{ flex:1,height:1,background:"#F3F4F6" }} />
      {label&&<span style={{ fontSize:9.5,fontWeight:800,color:"#D1D5DB",letterSpacing:"0.1em",textTransform:"uppercase" }}>{label}</span>}
      <div style={{ flex:1,height:1,background:"#F3F4F6" }} />
    </div>
  );
}
function TwoCol({ children }) { return <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>{children}</div>; }
function EstBox({ text }) {
  return <div style={{ padding:"10px 13px",background:"#F3F4F6",borderRadius:10,fontFamily:"monospace",fontSize:12.5,color:"#6B7280",fontWeight:600 }}>{text}</div>;
}
function InfoBox({ text, color="#92400E", bg="#FFFBEB", border="#FCD34D" }) {
  return <div style={{ padding:"10px 13px",background:bg,border:`1px solid ${border}`,borderRadius:10,fontSize:11.5,color,fontWeight:700,lineHeight:1.5 }}>{text}</div>;
}

// ─── CSV UPLOADER ─────────────────────────────────────────────────────────────
function parseCSV(text) {
  // Normalize line endings
  const lines = text.trim().replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if(lines.length < 2) return [];

  // Proper quoted-field CSV splitter — handles "field with, comma" correctly
  const splitCSV = line => {
    const fields = [];
    let cur = "", inQuote = false;
    for(let i = 0; i < line.length; i++){
      const ch = line[i];
      if(ch === '"') { inQuote = !inQuote; }
      else if(ch === "," && !inQuote) { fields.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    fields.push(cur.trim());
    return fields;
  };

  const cols = splitCSV(lines[0]).map(c => c.toLowerCase());

  // Detect columns by name, fall back to position
  let iDesc = cols.findIndex(c => c.includes("desc") || c.includes("memo") || c.includes("payee") || c.includes("transaction"));
  let iAmt  = cols.findIndex(c => c === "amount" || c.includes("amount"));
  let iDate = cols.findIndex(c => c.includes("date") || c.includes("posted"));

  // Positional fallbacks
  if(iDate === -1) iDate = 0;
  if(iDesc === -1) iDesc = cols.length >= 2 ? 1 : 0;
  if(iAmt  === -1) iAmt  = cols.length >= 3 ? 2 : cols.length - 1;

  const rows = [];
  for(let i = 1; i < lines.length; i++){
    if(!lines[i].trim()) continue;
    const clean = splitCSV(lines[i]);
    const amt = Math.abs(parseFloat((clean[iAmt] || "0").replace(/[$,\s]/g, "")));
    const description = clean[iDesc] || `Row ${i}`;
    if(!isNaN(amt) && amt > 0) rows.push({ date: clean[iDate] || "", description, amount: amt });
  }
  return rows;
}
async function aiCategorize(transactions) {
  const sample=transactions.slice(0,120);
  const prompt=`You are a financial categorization engine. Given bank transactions, return ONLY this JSON with estimated MONTHLY totals:
{"currentHousing":0,"carPayment":0,"otherDebts":0,"utilities":0,"groceries":0,"subscriptions":0,"otherLiving":0,"estimatedMonthlyIncome":0,"monthsDetected":1,"notes":""}
Rules: currentHousing=rent/mortgage/HOA. carPayment=auto loan. otherDebts=loans/credit minimums. utilities=electric/gas/water/internet/phone. groceries=supermarkets/grocery. subscriptions=Netflix/Spotify/gym/recurring. otherLiving=everything else. Divide by monthsDetected for monthly averages. ONLY JSON, no markdown.
Transactions:\n${sample.map(t=>`${t.date}|${t.description}|$${t.amount.toFixed(2)}`).join("\n")}`;

  const res = await fetch("/api/categorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if(!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.text || "";
  const clean = text.replace(/```json|```/g,"").trim();
  return JSON.parse(clean);
}
function CSVUploader({ b, setB, accentColor }) {
  const [status,setStatus]=useState("idle");
  const [message,setMessage]=useState("");
  const [result,setResult]=useState(null);
  const fileRef=useRef();
  const handleFile=async(e)=>{
    const file=e.target.files?.[0]; if(!file) return;
    setStatus("parsing"); setMessage("Reading your file…");
    try {
      const rows=parseCSV(await file.text());
      if(!rows||rows.length===0){ setStatus("error"); setMessage("Couldn't read this CSV. Make sure it has Description and Amount columns."); return; }
      setMessage(`Found ${rows.length} transactions. Categorizing with AI…`);
      const cat=await aiCategorize(rows);
      setB(p=>({ ...p, expenseMode:"detailed",
        currentHousing:Math.round(cat.currentHousing||p.currentHousing),
        carPayment:Math.round(cat.carPayment||p.carPayment),
        otherDebts:Math.round(cat.otherDebts||p.otherDebts),
        utilities:Math.round(cat.utilities||p.utilities),
        groceries:Math.round(cat.groceries||p.groceries),
        subscriptions:Math.round(cat.subscriptions||p.subscriptions),
        otherLiving:Math.round(cat.otherLiving||p.otherLiving),
        ...(cat.estimatedMonthlyIncome>0&&p.netIncome===0&&p.annualGross===0
          ?{incomeMode:"net",netIncome:Math.round(cat.estimatedMonthlyIncome)}:{}),
      }));
      setResult(cat); setStatus("done");
      setMessage(cat.notes||`Imported ${rows.length} transactions across ~${cat.monthsDetected} month(s).`);
    } catch(err){ setStatus("error"); setMessage(`Import failed: ${err.message}`); }
    fileRef.current.value="";
  };
  return (
    <div style={{ marginBottom:20 }}>
      <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} style={{ display:"none" }} id="csv-upload" />
      {status==="idle"&&(
        <label htmlFor="csv-upload" style={{ display:"flex",alignItems:"center",gap:12,padding:"14px 16px",border:`2px dashed ${accentColor}55`,borderRadius:14,cursor:"pointer",background:"#FAFAFA" }}
          onMouseOver={e=>e.currentTarget.style.background="#FFF7ED"} onMouseOut={e=>e.currentTarget.style.background="#FAFAFA"}>
          <span style={{ fontSize:24 }}>📂</span>
          <div>
            <div style={{ fontSize:13,fontWeight:800,color:"#374151" }}>Upload bank statement CSV</div>
            <div style={{ fontSize:11,color:"#9CA3AF",marginTop:2 }}>AI auto-categorizes your transactions. Works with most banks.</div>
          </div>
        </label>
      )}
      {status==="parsing"&&<div style={{ display:"flex",alignItems:"center",gap:12,padding:"14px 16px",background:THEME.baseline.light,border:`1.5px solid ${THEME.baseline.border}`,borderRadius:14 }}><span style={{ fontSize:20 }}>⏳</span><span style={{ fontSize:13,fontWeight:700,color:THEME.baseline.dim }}>{message}</span></div>}
      {status==="done"&&(
        <div style={{ padding:"14px 16px",background:"#ECFDF5",border:"1.5px solid #6EE7B7",borderRadius:14 }}>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start" }}>
            <div style={{ display:"flex",gap:10,alignItems:"center" }}><span style={{ fontSize:18 }}>✅</span><div><div style={{ fontSize:13,fontWeight:800,color:"#065F46" }}>Expenses imported!</div><div style={{ fontSize:11,color:"#059669",marginTop:1 }}>{message}</div></div></div>
            <button onClick={()=>{setStatus("idle");setResult(null);}} style={{ fontSize:11,color:"#9CA3AF",background:"none",border:"none",cursor:"pointer",fontWeight:700 }}>Re-upload</button>
          </div>
          {result&&<div style={{ marginTop:10,paddingTop:10,borderTop:"1px solid #A7F3D0",display:"flex",gap:8,flexWrap:"wrap" }}>
            {[["Housing",result.currentHousing],["Car",result.carPayment],["Utilities",result.utilities],["Groceries",result.groceries],["Subs",result.subscriptions],["Other",result.otherLiving]].filter(([,v])=>v>0).map(([l,v])=>(
              <div key={l} style={{ fontSize:10.5,color:"#065F46",fontWeight:700,background:"#D1FAE5",padding:"2px 8px",borderRadius:20 }}>{l}: {fmt(v)}</div>
            ))}
          </div>}
        </div>
      )}
      {status==="error"&&(
        <div style={{ padding:"14px 16px",background:"#FEF2F2",border:"1.5px solid #FCA5A5",borderRadius:14 }}>
          <div style={{ display:"flex",gap:10,alignItems:"center",marginBottom:8 }}><span style={{ fontSize:18 }}>⚠️</span><span style={{ fontSize:13,fontWeight:800,color:"#991B1B" }}>Import failed</span></div>
          <div style={{ fontSize:12,color:"#DC2626",marginBottom:10 }}>{message}</div>
          <label htmlFor="csv-upload" style={{ fontSize:12,fontWeight:800,color:accentColor,cursor:"pointer" }}>Try again →</label>
        </div>
      )}
    </div>
  );
}

// ─── TAB 1: BASELINE ─────────────────────────────────────────────────────────
function BaselineTab({ b, setB }) {
  const set=k=>v=>setB(p=>({...p,[k]:v}));
  const ac=THEME.baseline.solid;
  const taxResult=b.incomeMode==="gross"&&b.annualGross>0 ? calcNetMonthly(b.annualGross,b.filingStatus,b.state) : null;
  return (
    <div>
      <p style={{ fontSize:13,color:"#9CA3AF",marginBottom:22,lineHeight:1.65,fontWeight:500 }}>Your current financial picture. Skip optional fields for a quick estimate.</p>

      <Field label="Income">
        <div style={{ marginBottom:10 }}>
          <Pill value={b.incomeMode} onChange={set("incomeMode")} accentColor={ac}
            options={[{value:"gross",label:"Annual Gross"},{value:"net",label:"Monthly Take-home"}]} />
        </div>
        {b.incomeMode==="gross" ? (
          <>
            <Num value={b.annualGross} onChange={set("annualGross")} prefix="$" suffix="/yr" accentColor={ac} />
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:10 }}>
              <div>
                <div style={{ fontSize:10,fontWeight:800,color:"#9CA3AF",letterSpacing:"0.07em",textTransform:"uppercase",marginBottom:5 }}>Filing Status</div>
                <SelInput value={b.filingStatus} onChange={set("filingStatus")} accentColor={ac}>
                  <option value="single">Single</option>
                  <option value="married">Married (joint)</option>
                  <option value="hoh">Head of household</option>
                </SelInput>
              </div>
              <div>
                <div style={{ fontSize:10,fontWeight:800,color:"#9CA3AF",letterSpacing:"0.07em",textTransform:"uppercase",marginBottom:5 }}>State</div>
                <SelInput value={b.state} onChange={set("state")} accentColor={ac}>
                  {Object.entries(STATE_NAMES).sort(([,a],[,bb])=>a.localeCompare(bb)).map(([k,v])=>(
                    <option key={k} value={k}>{v}</option>
                  ))}
                </SelInput>
              </div>
            </div>
            {taxResult&&<div style={{ marginTop:12,padding:"14px 16px",background:THEME.baseline.light,border:`1.5px solid ${THEME.baseline.border}`,borderRadius:12 }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8 }}>
                <span style={{ fontSize:12,fontWeight:800,color:THEME.baseline.dim }}>Estimated monthly take-home</span>
                <span style={{ fontSize:18,fontWeight:900,color:ac,fontFamily:"monospace" }}>{fmt(taxResult.net)}/mo</span>
              </div>
              <div style={{ display:"flex",gap:12,flexWrap:"wrap" }}>
                {[["Federal",taxResult.breakdown.federal],["FICA",taxResult.breakdown.fica],[`${b.state} state`,taxResult.breakdown.state]].map(([l,v])=>(
                  <div key={l} style={{ fontSize:11,color:THEME.baseline.dim,fontWeight:700 }}>{l}: <span style={{ fontFamily:"monospace" }}>{fmt(v)}/mo</span></div>
                ))}
                <div style={{ fontSize:11,color:THEME.baseline.dim,fontWeight:700 }}>Effective: {pct(taxResult.effectiveRate)}</div>
              </div>
              <div style={{ fontSize:10,color:"#B45309",marginTop:8,fontStyle:"italic" }}>Based on 2024 federal brackets + standard deduction. State rate is approximate.</div>
            </div>}
          </>
        ) : (
          <Num value={b.netIncome} onChange={set("netIncome")} prefix="$" suffix="/mo" accentColor={ac} />
        )}
      </Field>

      {/* ── Partner / additional income ── */}
      {!b.showPartnerIncome ? (
        <div style={{ textAlign:"center", marginTop:-8, marginBottom:18 }}>
          <button onClick={()=>setB(p=>({...p,showPartnerIncome:true}))}
            style={{ background:"none",border:"none",fontSize:12.5,fontWeight:800,color:ac,cursor:"pointer",textDecoration:"underline",textUnderlineOffset:3,padding:4 }}>
            + Add another income
          </button>
        </div>
      ) : (
        <Field label="Additional Income">
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8 }}>
            <Pill value={b.partnerIncomeMode} onChange={set("partnerIncomeMode")} accentColor={ac}
              options={[{value:"gross",label:"Annual Gross"},{value:"net",label:"Monthly Take-home"}]} />
            <button onClick={()=>setB(p=>({...p,showPartnerIncome:false,partnerAnnualGross:0,partnerNetIncome:0}))}
              style={{ background:"none",border:"none",fontSize:11,fontWeight:700,color:"#9CA3AF",cursor:"pointer" }}>Remove</button>
          </div>
          {b.partnerIncomeMode==="gross"
            ? <Num value={b.partnerAnnualGross} onChange={set("partnerAnnualGross")} prefix="$" suffix="/yr" accentColor={ac} />
            : <Num value={b.partnerNetIncome} onChange={set("partnerNetIncome")} prefix="$" suffix="/mo" accentColor={ac} />}
          {(()=>{
            const primary = b.incomeMode==="gross" ? calcNetMonthly(b.annualGross,b.filingStatus,b.state).net : b.netIncome;
            const partner = b.partnerIncomeMode==="gross" ? calcNetMonthly(b.partnerAnnualGross,"single",b.state).net : b.partnerNetIncome;
            const combined = primary + partner;
            if(!combined) return null;
            return <div style={{ marginTop:10,padding:"12px 14px",background:THEME.baseline.light,border:`1.5px solid ${THEME.baseline.border}`,borderRadius:12,display:"flex",justifyContent:"space-between",alignItems:"center" }}>
              <span style={{ fontSize:12,fontWeight:800,color:THEME.baseline.dim }}>Combined take-home</span>
              <span style={{ fontSize:17,fontWeight:900,color:ac,fontFamily:"monospace" }}>{fmt(combined)}/mo</span>
            </div>;
          })()}
        </Field>
      )}

      <Field label="Cash Savings" hint="liquid only">
        <Num value={b.savings} onChange={set("savings")} prefix="$" accentColor={ac} />
        {(()=>{
          const { total } = getBaselineExpenses(b);
          const runway = total > 0 && b.savings > 0 ? b.savings / total : 0;
          if(!runway) return null;
          const color = runway >= 6 ? "#059669" : runway >= 3 ? "#D97706" : "#DC2626";
          const label = runway >= 6 ? "✓ solid cushion" : runway >= 3 ? "⚡ below 6-mo target" : "⚠ below 3-mo floor";
          return <div style={{ marginTop:6,fontSize:11,fontWeight:700,color }}>{mths(runway)} of expenses · {label}</div>;
        })()}
      </Field>

      <div style={{ marginBottom:16 }}>
        <Pill value={b.expenseMode} onChange={set("expenseMode")} accentColor={ac}
          options={[{value:"simple",label:"Simple"},{value:"detailed",label:"Detailed"},{value:"csv",label:"📂 Import CSV"}]} />
      </div>

      {b.expenseMode==="simple"&&(
        <div>
          <Field label="Current Housing" hint="rent or mortgage"><Num value={b.currentHousing} onChange={set("currentHousing")} prefix="$" suffix="/mo" accentColor={ac} /></Field>
          <Field label="All Other Monthly Expenses" hint="everything else">
            <Num value={b.simpleOther} onChange={v=>setB(p=>({...p,simpleOther:v,simpleTotal:p.currentHousing+v}))} prefix="$" suffix="/mo" accentColor={ac} />
          </Field>
          <InfoBox text={`Total monthly expenses: ${fmt(b.currentHousing+b.simpleOther)}/mo · Switch to Detailed to break these out.`} />
        </div>
      )}
      {b.expenseMode==="detailed"&&(
        <div>
          <Field label="Current Housing" hint="rent or mortgage"><Num value={b.currentHousing} onChange={set("currentHousing")} prefix="$" suffix="/mo" accentColor={ac} /></Field>
          <Divider label="Debts" />
          <TwoCol>
            <Field label="Car Payment"><Num value={b.carPayment} onChange={set("carPayment")} prefix="$" accentColor={ac} /></Field>
            <Field label="Other Debt" optional><Num value={b.otherDebts} onChange={set("otherDebts")} prefix="$" accentColor={ac} /></Field>
          </TwoCol>
          <Divider label="Living" />
          <TwoCol>
            <Field label="Utilities" optional><Num value={b.utilities} onChange={set("utilities")} prefix="$" accentColor={ac} /></Field>
            <Field label="Groceries" optional><Num value={b.groceries} onChange={set("groceries")} prefix="$" accentColor={ac} /></Field>
          </TwoCol>
          <TwoCol>
            <Field label="Subscriptions" optional><Num value={b.subscriptions} onChange={set("subscriptions")} prefix="$" accentColor={ac} /></Field>
            <Field label="Other" optional><Num value={b.otherLiving} onChange={set("otherLiving")} prefix="$" accentColor={ac} /></Field>
          </TwoCol>
        </div>
      )}
      {b.expenseMode==="csv"&&(
        <div>
          <CSVUploader b={b} setB={setB} accentColor={ac} />
          <div style={{ padding:"12px 14px",background:"#F9FAFB",borderRadius:12,border:"1.5px solid #E5E7EB",marginBottom:12 }}>
            <div style={{ fontSize:10.5,fontWeight:800,color:"#9CA3AF",letterSpacing:"0.07em",textTransform:"uppercase",marginBottom:10 }}>Review & adjust</div>
            <Field label="Current Housing"><Num value={b.currentHousing} onChange={set("currentHousing")} prefix="$" accentColor={ac} /></Field>
            <TwoCol>
              <Field label="Car Payment"><Num value={b.carPayment} onChange={set("carPayment")} prefix="$" accentColor={ac} /></Field>
              <Field label="Other Debt"><Num value={b.otherDebts} onChange={set("otherDebts")} prefix="$" accentColor={ac} /></Field>
            </TwoCol>
            <TwoCol>
              <Field label="Utilities"><Num value={b.utilities} onChange={set("utilities")} prefix="$" accentColor={ac} /></Field>
              <Field label="Groceries"><Num value={b.groceries} onChange={set("groceries")} prefix="$" accentColor={ac} /></Field>
            </TwoCol>
            <TwoCol>
              <Field label="Subscriptions"><Num value={b.subscriptions} onChange={set("subscriptions")} prefix="$" accentColor={ac} /></Field>
              <Field label="Other"><Num value={b.otherLiving} onChange={set("otherLiving")} prefix="$" accentColor={ac} /></Field>
            </TwoCol>
          </div>
        </div>
      )}
      <BaselineHealthCheck b={b} />

    </div>
  );
}

function BaselineHealthCheck({ b }) {
  const [open, setOpen] = useState(false);
  const net = getBaselineIncome(b).net;
  const { total, housing } = getBaselineExpenses(b);
  const surplus  = net - total;
  const housingR = net > 0 ? housing / net : 0;
  const debtR    = net > 0 ? (b.carPayment + b.otherDebts) / net : 0;
  const runway   = total > 0 ? b.savings / total : 0;
  const hasData  = net > 0 || total > 0;

  const checks = [
    {
      label: "Housing cost",
      pass: housingR <= 0.28, warn: housingR <= 0.35,
      note: net > 0 ? `${pct(housingR)} of take-home — target ≤ 28%` : "Enter income to calculate",
    },
    {
      label: "Debt load",
      pass: debtR <= 0.10, warn: debtR <= 0.15,
      note: net > 0 ? `${pct(debtR)} of take-home on debt payments` : "Enter income to calculate",
    },
    {
      label: "Monthly surplus",
      pass: surplus > net * 0.30, warn: surplus > net * 0.15,
      note: net > 0
        ? surplus < 0 ? "Expenses exceed income"
          : surplus < net * 0.30
            ? `${fmt(surplus)}/mo remaining — 30% of take-home (${fmt(net*0.30)}) recommended for discretionary spending`
            : `${fmt(surplus)}/mo remaining`
        : "Enter income to calculate",
    },
    {
      label: "Emergency runway",
      pass: runway >= 6, warn: runway >= 3,
      note: total > 0 ? `${mths(runway)} of expenses in savings` : "Enter expenses to calculate",
    },
  ];

  const flags  = checks.filter(c => !c.pass && !c.warn).length;
  const warns  = checks.filter(c => !c.pass && c.warn).length;
  const overall = flags > 0 ? "RISKY" : warns > 1 ? "STRETCH" : "SAFE";
  const oc = overall === "SAFE" ? "#059669" : overall === "STRETCH" ? "#D97706" : "#DC2626";
  const ob = overall === "SAFE" ? "#ECFDF5" : overall === "STRETCH" ? "#FFFBEB" : "#FEF2F2";
  const obdr = overall === "SAFE" ? "#6EE7B7" : overall === "STRETCH" ? "#FCD34D" : "#FCA5A5";

  return (
    <div style={{ marginTop:24 }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"13px 16px", borderRadius:13,
        background: hasData ? ob : "#F9FAFB",
        border: `1.5px solid ${hasData ? obdr : "#E5E7EB"}`,
        cursor:"pointer", transition:"all 0.15s",
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:16 }}>📊</span>
          <span style={{ fontSize:13, fontWeight:800, color: hasData ? oc : "#9CA3AF" }}>
            Current Financial Health
          </span>
          {hasData && (
            <span style={{ fontSize:11, fontWeight:800, color: oc, background: `${oc}18`, padding:"2px 9px", borderRadius:20 }}>
              {overall === "SAFE" ? "✓ Healthy" : overall === "STRETCH" ? "⚡ Watch" : "! Needs attention"}
            </span>
          )}
        </div>
        <span style={{ fontSize:12, color:"#C4C4C4", fontWeight:800 }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ marginTop:8, padding:"16px 18px", background:"#fff", border:"1.5px solid #F3F4F6", borderRadius:13 }}>
          {!hasData && (
            <p style={{ fontSize:12.5, color:"#9CA3AF", fontWeight:600, textAlign:"center", padding:"8px 0" }}>
              Fill in your income and expenses above to see your financial health snapshot.
            </p>
          )}
          {hasData && (
            <div style={{ display:"flex", flexDirection:"column", gap:9 }}>
              {checks.map(({ label, pass, warn, note }) => {
                const s = pass ? { bg:"#ECFDF5", dot:"#059669", tag:"#059669", tagBg:"#D1FAE5", tagLabel:"Good" }
                         : warn ? { bg:"#FFFBEB", dot:"#D97706", tag:"#D97706", tagBg:"#FEF3C7", tagLabel:"Watch" }
                         :        { bg:"#FEF2F2", dot:"#DC2626", tag:"#DC2626", tagBg:"#FEE2E2", tagLabel:"Flag" };
                return (
                  <div key={label} style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 14px", background:s.bg, borderRadius:11 }}>
                    <div style={{ width:9, height:9, borderRadius:"50%", background:s.dot, flexShrink:0 }} />
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13, fontWeight:800, color:"#1F2937" }}>{label}</div>
                      <div style={{ fontSize:12, color:"#6B7280", marginTop:2, fontWeight:600 }}>{note}</div>
                    </div>
                    <div style={{ padding:"3px 10px", borderRadius:20, background:s.tagBg, fontSize:11, fontWeight:800, color:s.tag, whiteSpace:"nowrap" }}>{s.tagLabel}</div>
                  </div>
                );
              })}
            </div>
          )}
          <p style={{ fontSize:10.5, color:"#D1D5DB", marginTop:14, textAlign:"center" }}>
            Snapshot of your current situation — not your scenario.
          </p>
        </div>
      )}
    </div>
  );
}
function ScenarioHome({ sc, setSc, b, setB }) {
  const set=k=>v=>setSc(p=>({...p,[k]:v})); const ac=SCENARIO_META.home.color;

  // Synced down payment handlers
  const onDownDollar = v => {
    const pct = sc.homePrice > 0 ? (v / sc.homePrice) * 100 : 0;
    setSc(p => ({ ...p, downPayment: v, downPaymentPct: parseFloat(pct.toFixed(2)) }));
  };
  const onDownPct = v => {
    const dollar = sc.homePrice > 0 ? Math.round((v / 100) * sc.homePrice) : 0;
    setSc(p => ({ ...p, downPaymentPct: v, downPayment: dollar }));
  };
  // When home price changes, keep % locked and recalc $
  const onHomePrice = v => {
    const dollar = sc.downPaymentPct > 0 ? Math.round((sc.downPaymentPct / 100) * v) : sc.downPayment;
    setSc(p => ({ ...p, homePrice: v, downPayment: dollar }));
  };

  return (
    <div>
      <Divider label="Home Details" />
      <Field label="Home Price"><Num value={sc.homePrice} onChange={onHomePrice} prefix="$" accentColor={ac} /></Field>

      {/* Down payment — synced $ and % */}
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:11,fontWeight:800,letterSpacing:"0.07em",textTransform:"uppercase",color:"#6B7280",marginBottom:6 }}>Down Payment</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          <Num value={sc.downPayment||""} onChange={onDownDollar} prefix="$" accentColor={ac} />
          <Num value={sc.downPaymentPct||""} onChange={onDownPct} suffix="%" accentColor={ac} />
        </div>
        {sc.homePrice > 0 && sc.downPayment > 0 && (
          <div style={{ marginTop:6, fontSize:11, color:"#9CA3AF", fontWeight:600 }}>
            {sc.downPayment < sc.homePrice * 0.20
              ? "⚠ Under 20% — PMI will likely apply"
              : "✓ 20%+ — no PMI required"}
          </div>
        )}
      </div>

      <TwoCol>
        <Field label="Interest Rate"><Num value={sc.interestRate} onChange={set("interestRate")} suffix="% APR" accentColor={ac} /></Field>
        <Field label="Loan Term"><Num value={sc.loanTerm} onChange={set("loanTerm")} suffix="yrs" accentColor={ac} /></Field>
      </TwoCol>
      <Field label="Property Tax"><Num value={sc.annualTax} onChange={set("annualTax")} prefix="$" suffix="/yr" accentColor={ac} /></Field>
      <Divider label="Estimated Costs" />
      <Field label="Homeowners Insurance">
        <div style={{ display:"flex",gap:10,alignItems:"center",marginBottom:8 }}>
          <Pill value={sc.useDefaultIns?"est":"custom"} accentColor={ac} onChange={v=>setSc(p=>({...p,useDefaultIns:v==="est"}))} options={[{value:"est",label:"Estimate"},{value:"custom",label:"Custom"}]} />
          {sc.useDefaultIns&&<span style={{ fontSize:11,color:"#C4C4C4",fontWeight:600 }}>0.35% of price</span>}
        </div>
        {sc.useDefaultIns ? <EstBox text={`≈ ${fmt(sc.homePrice*0.0035)}/yr  →  ${fmt(sc.homePrice*0.0035/12)}/mo`} /> : <Num value={sc.annualInsurance} onChange={set("annualInsurance")} prefix="$" suffix="/yr" accentColor={ac} />}
      </Field>
      <Field label="Closing Costs">
        <div style={{ display:"flex",gap:10,alignItems:"center",marginBottom:8 }}>
          <Pill value={sc.useDefaultClose?"est":"custom"} accentColor={ac} onChange={v=>setSc(p=>({...p,useDefaultClose:v==="est"}))} options={[{value:"est",label:"Estimate"},{value:"custom",label:"Custom"}]} />
          {sc.useDefaultClose&&<span style={{ fontSize:11,color:"#C4C4C4",fontWeight:600 }}>3% of price</span>}
        </div>
        {sc.useDefaultClose ? <EstBox text={`≈ ${fmt(sc.homePrice*0.03)}`} /> : <Num value={sc.closingCosts} onChange={set("closingCosts")} prefix="$" accentColor={ac} />}
      </Field>
      {(()=>{ const downPct = sc.homePrice>0 ? sc.downPayment/sc.homePrice : 1; const loan = Math.max(0, sc.homePrice-sc.downPayment); const pmiApplies = downPct < 0.20 && loan > 0; if(!pmiApplies) return null;
        const pmiAmt = sc.useDefaultPmi ? (loan*0.0085)/12 : (loan*(sc.pmiRate/100))/12;
        return (
          <Field label="PMI (Private Mortgage Insurance)">
            <div style={{ display:"flex",gap:10,alignItems:"center",marginBottom:8 }}>
              <Pill value={sc.useDefaultPmi?"est":"custom"} accentColor={ac} onChange={v=>setSc(p=>({...p,useDefaultPmi:v==="est"}))} options={[{value:"est",label:"Estimate"},{value:"custom",label:"Custom"}]} />
              {sc.useDefaultPmi&&<span style={{ fontSize:11,color:"#C4C4C4",fontWeight:600 }}>0.85% of loan/yr</span>}
            </div>
            {sc.useDefaultPmi
              ? <EstBox text={`≈ ${fmt(pmiAmt)}/mo — drops off at 20% equity`} />
              : <Num value={sc.pmiRate||""} onChange={set("pmiRate")} suffix="% of loan/yr" accentColor={ac} />}
          </Field>
        );
      })()}
      <Field label="HOA / Condo Fees (optional)">
        <Num value={sc.hoaMonthly||""} onChange={set("hoaMonthly")} prefix="$" suffix="/mo" accentColor={ac} />
      </Field>
      <Field label="Do you currently own a home?">
        <div style={{ display:"flex",gap:10,marginTop:4 }}>
          {[{val:true,label:"Yes"},{val:false,label:"No"}].map(({val,label})=>(
            <button key={label} onClick={()=>setB(p=>({...p,ownsHome:val}))}
              style={{ flex:1,padding:"10px 0",borderRadius:12,border:`1.5px solid ${b?.ownsHome===val?ac:"#E5E7EB"}`,
                background:b?.ownsHome===val?ac:"#fff",color:b?.ownsHome===val?"#fff":"#6B7280",
                fontWeight:800,fontSize:13,cursor:"pointer",transition:"all 0.15s" }}>
              {label}
            </button>
          ))}
        </div>
      </Field>
    </div>
  );
}

function ScenarioCar({ sc, setSc }) {
  const set=k=>v=>setSc(p=>({...p,[k]:v})); const ac=SCENARIO_META.car.color;
  const calcedPayment = sc.carMode==="buy"&&!sc.useKnownPayment
    ? calcLoanPayment(Math.max(0,(sc.msrp-sc.tradeIn)-sc.downPayment), sc.carRate, sc.carTerm)
    : null;
  return (
    <div>
      <Divider label="Buy or Lease?" />
      <div style={{ marginBottom:18 }}>
        <Pill value={sc.carMode} onChange={set("carMode")} accentColor={ac}
          options={[{value:"buy",label:"🚗 Buy"},{value:"lease",label:"📋 Lease"}]} />
      </div>

      {sc.carMode==="buy"&&(
        <>
          <Field label="Car MSRP / Price"><Num value={sc.msrp} onChange={set("msrp")} prefix="$" accentColor={ac} /></Field>
          <TwoCol>
            <Field label="Down Payment"><Num value={sc.downPayment} onChange={set("downPayment")} prefix="$" accentColor={ac} /></Field>
            <Field label="Trade-in Value" optional><Num value={sc.tradeIn} onChange={set("tradeIn")} prefix="$" accentColor={ac} /></Field>
          </TwoCol>
          <div style={{ marginBottom:16 }}>
            <Pill value={sc.useKnownPayment?"known":"calc"} onChange={v=>setSc(p=>({...p,useKnownPayment:v==="known"}))} accentColor={ac}
              options={[{value:"calc",label:"Calculate payment"},{value:"known",label:"I know my payment"}]} />
          </div>
          {sc.useKnownPayment ? (
            <Field label="Monthly Payment"><Num value={sc.knownPayment} onChange={set("knownPayment")} prefix="$" suffix="/mo" accentColor={ac} /></Field>
          ) : (
            <>
              <TwoCol>
                <Field label="Interest Rate"><Num value={sc.carRate} onChange={set("carRate")} suffix="% APR" accentColor={ac} /></Field>
                <Field label="Loan Term"><Num value={sc.carTerm} onChange={set("carTerm")} suffix="yrs" accentColor={ac} /></Field>
              </TwoCol>
              {calcedPayment>0&&<EstBox text={`Estimated payment: ${fmt(calcedPayment)}/mo`} />}
            </>
          )}
        </>
      )}

      {sc.carMode==="lease"&&(
        <>
          <TwoCol>
            <Field label="Monthly Lease"><Num value={sc.leaseMonthly} onChange={set("leaseMonthly")} prefix="$" suffix="/mo" accentColor={ac} /></Field>
            <Field label="Lease Term"><Num value={sc.leaseTerm} onChange={set("leaseTerm")} suffix="mos" accentColor={ac} /></Field>
          </TwoCol>
          <Field label="Due at Signing" hint="first month + fees" optional><Num value={sc.leaseDownPayment} onChange={set("leaseDownPayment")} prefix="$" accentColor={ac} /></Field>
        </>
      )}

      <Divider label="Additional Costs" />
      <Field label="Insurance Change" hint="monthly increase vs current" optional>
        <Num value={sc.insuranceDelta} onChange={set("insuranceDelta")} prefix="$" suffix="/mo" accentColor={ac} />
      </Field>
      <InfoBox text="Insurance delta = new monthly premium minus what you pay today. Leave at 0 if replacing an existing car." />
    </div>
  );
}

function ScenarioJob({ sc, setSc, b }) {
  const set=k=>v=>setSc(p=>({...p,[k]:v})); const ac=SCENARIO_META.job.color;
  const newTax=sc.newAnnualSalary>0 ? calcNetMonthly(sc.newAnnualSalary, b.filingStatus, b.state) : null;
  const oldNet=getBaselineIncome(b).net;
  return (
    <div>
      <Divider label="New Compensation" />
      <Field label="New Annual Salary">
        <Num value={sc.newAnnualSalary} onChange={set("newAnnualSalary")} prefix="$" suffix="/yr" accentColor={ac} />
      </Field>
      {newTax&&sc.newAnnualSalary>0&&(
        <div style={{ marginBottom:16,padding:"12px 14px",background:"#F5F3FF",border:"1.5px solid #C4B5FD",borderRadius:12 }}>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6 }}>
            <span style={{ fontSize:12,fontWeight:800,color:"#5B21B6" }}>New take-home</span>
            <span style={{ fontSize:16,fontWeight:900,color:ac,fontFamily:"monospace" }}>{fmt(newTax.net)}/mo</span>
          </div>
          <div style={{ fontSize:12,color:newTax.net>oldNet?"#059669":"#DC2626",fontWeight:700 }}>
            {newTax.net>oldNet?"▲":"▼"} {fmt(Math.abs(newTax.net-oldNet))}/mo vs current take-home · Effective rate: {pct(newTax.effectiveRate)}
          </div>
        </div>
      )}
      <TwoCol>
        <Field label="Signing Bonus" optional><Num value={sc.signingBonus} onChange={set("signingBonus")} prefix="$" accentColor={ac} /></Field>
        <Field label="Relocation Costs" optional><Num value={sc.relocationCosts} onChange={set("relocationCosts")} prefix="$" accentColor={ac} /></Field>
      </TwoCol>

      <Divider label="Commute" />
      <TwoCol>
        <Field label="Current Commute Cost" hint="/mo"><Num value={sc.oldCommuteCost} onChange={set("oldCommuteCost")} prefix="$" accentColor={ac} /></Field>
        <Field label="New Commute Cost" hint="/mo"><Num value={sc.newCommuteCost} onChange={set("newCommuteCost")} prefix="$" accentColor={ac} /></Field>
      </TwoCol>

      <Divider label="Benefits Impact" />
      <Field label="Net Benefits Cost Change" hint="monthly" optional>
        <Num value={sc.benefitsCost} onChange={set("benefitsCost")} prefix="$" suffix="/mo" accentColor={ac} />
      </Field>
      <InfoBox text="If your new job has worse benefits (e.g. you lose employer health coverage), enter the extra monthly cost here. Use a negative number if benefits improve." color="#5B21B6" bg="#F5F3FF" border="#C4B5FD" />
    </div>
  );
}

function ScenarioApt({ sc, setSc }) {
  const set=k=>v=>setSc(p=>({...p,[k]:v})); const ac=SCENARIO_META.apt.color;
  return (
    <div>
      <Divider label="New Apartment" />
      <Field label="New Monthly Rent">
        <Num value={sc.newRent} onChange={set("newRent")} prefix="$" suffix="/mo" accentColor={ac} />
      </Field>
      <Divider label="Move-in Costs" />
      <TwoCol>
        <Field label="Security Deposit" optional><Num value={sc.securityDeposit} onChange={set("securityDeposit")} prefix="$" accentColor={ac} /></Field>
        <Field label="Moving Costs" optional><Num value={sc.moveCosts} onChange={set("moveCosts")} prefix="$" accentColor={ac} /></Field>
      </TwoCol>
      <InfoBox text="Security deposit and moving costs reduce your emergency fund savings but don't affect monthly cash flow." color="#0F766E" bg="#F0FDFA" border="#99F6E4" />
    </div>
  );
}

function ScenarioSavings({ sc, setSc }) {
  const set=k=>v=>setSc(p=>({...p,[k]:v})); const ac=SCENARIO_META.savings.color;
  return (
    <div>
      <Divider label="Your Goal" />
      <Field label="Savings Goal">
        <Num value={sc.savingsGoal} onChange={set("savingsGoal")} prefix="$" accentColor={ac} />
      </Field>
      <Field label="Already Saved" optional>
        <Num value={sc.savingsAlreadySaved} onChange={set("savingsAlreadySaved")} prefix="$" accentColor={ac} />
      </Field>
      <Divider label="Time Constraint" />
      <Field label="Target Months Away" optional hint="leave blank for options">
        <Num value={sc.savingsTargetMonths||""} onChange={set("savingsTargetMonths")} suffix="months" accentColor={ac} />
      </Field>
      <InfoBox text="Leave the time constraint blank and we'll show you aggressive, moderate, and relaxed savings timelines based on your monthly surplus." color={ac} bg="#FFFBEB" border="#FCD34D" />
    </div>
  );
}

function ScenarioDaycare({ sc, setSc }) {
  const set=k=>v=>setSc(p=>({...p,[k]:v})); const ac=SCENARIO_META.daycare.color;
  return (
    <div>
      <Divider label="Daycare Costs" />
      <TwoCol>
        <Field label="Number of Children">
          <Num value={sc.daycareChildren} onChange={set("daycareChildren")} accentColor={ac} />
        </Field>
        <Field label="Cost Per Child">
          <Num value={sc.daycareCostPerChild} onChange={set("daycareCostPerChild")} prefix="$" suffix="/mo" accentColor={ac} />
        </Field>
      </TwoCol>
      <Field label="Dependent Care FSA" optional hint="annual benefit">
        <Num value={sc.daycareFSA} onChange={set("daycareFSA")} prefix="$" suffix="/yr" accentColor={ac} />
      </Field>
      <InfoBox text="FSA benefit is divided across 12 months to reduce your net monthly daycare cost." color={ac} bg="#FDF2F8" border="#FBCFE8" />
      <Divider label="Lost Income (if one parent stops working)" />
      <Field label="Monthly Lost Income" optional hint="after-tax">
        <Num value={sc.daycareLostIncome} onChange={set("daycareLostIncome")} prefix="$" suffix="/mo" accentColor={ac} />
      </Field>
      <InfoBox text="Enter the take-home pay of the parent who would stop working. We'll show whether it's financially worth both of you working." color={ac} bg="#FDF2F8" border="#FBCFE8" />
    </div>
  );
}

function ScenarioTab({ sc, setSc, b, setB }) {
  const set=k=>v=>setSc(p=>({...p,[k]:v}));
  const [hovered, setHovered] = useState(null);
  const scenarios=[
    { id:"home",    ...SCENARIO_META.home,    time:"~3 min" },
    { id:"car",     ...SCENARIO_META.car,     time:"~2 min" },
    { id:"job",     ...SCENARIO_META.job,     time:"~2 min" },
    { id:"apt",     ...SCENARIO_META.apt,     time:"~1 min" },
    { id:"daycare", ...SCENARIO_META.daycare, time:"~2 min" },
    { id:"savings", ...SCENARIO_META.savings, time:"~1 min" },
  ];
  return (
    <div>
      <div style={{ marginBottom:22 }}>
        <div style={{ fontSize:10,fontWeight:800,color:"#9CA3AF",letterSpacing:"0.09em",textTransform:"uppercase",marginBottom:10 }}>What are you considering?</div>
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
          {scenarios.map(s=>{
            const active=sc.type===s.id;
            const isHov=hovered===s.id;
            return (
              <button key={s.id} onClick={()=>set("type")(s.id)}
                onMouseEnter={()=>setHovered(s.id)} onMouseLeave={()=>setHovered(null)}
                style={{
                  padding:"0",borderRadius:14,cursor:"pointer",textAlign:"center",
                  border:`2.5px solid ${active?s.color:isHov?s.color+"88":"#E5E7EB"}`,
                  background:active?`${s.color}11`:isHov?`${s.color}07`:"#F9FAFB",
                  transition:"all 0.18s",overflow:"hidden",
                  boxShadow:active?`0 4px 16px ${s.color}33`:isHov?`0 4px 12px ${s.color}22`:"none",
                  transform:isHov&&!active?"translateY(-2px)":"none",
                }}>
                {/* colored top bar */}
                <div style={{ height:3, background:active?s.color:isHov?s.color+"66":"transparent", transition:"all 0.18s" }} />
                <div style={{ padding:"12px 10px 14px" }}>
                  <div style={{ fontSize:26,marginBottom:5 }}>{s.emoji}</div>
                  <div style={{ fontSize:12,fontWeight:800,color:active?s.color:isHov?s.color:"#9CA3AF",transition:"color 0.18s" }}>{s.label}</div>
                  <div style={{ fontSize:10,color:"#C4C4C4",fontWeight:600,marginTop:3 }}>{s.time}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
      {sc.type==="home"   &&<ScenarioHome    sc={sc} setSc={setSc} b={b} setB={setB} />}
      {sc.type==="car"    &&<ScenarioCar     sc={sc} setSc={setSc} />}
      {sc.type==="job"    &&<ScenarioJob     sc={sc} setSc={setSc} b={b} />}
      {sc.type==="apt"    &&<ScenarioApt     sc={sc} setSc={setSc} />}
      {sc.type==="daycare"&&<ScenarioDaycare sc={sc} setSc={setSc} />}
      {sc.type==="savings"&&<ScenarioSavings sc={sc} setSc={setSc} />}
    </div>
  );
}

// ─── TAB 3: RESULTS ──────────────────────────────────────────────────────────
function AnimatedMoney({ value, decimals=0 }) {
  const n = useAnimatedNumber(value || 0);
  return <>{fmt(n, decimals)}</>;
}

function StressBar({ ratio, passThreshold, warnThreshold, pass, warn }) {
  const [width, setWidth] = useState(0);
  useEffect(() => { const t = setTimeout(() => setWidth(Math.min(100, ratio * 100)), 80); return () => clearTimeout(t); }, [ratio]);
  const color = pass ? "#059669" : warn ? "#D97706" : "#DC2626";
  const trackPct = passThreshold * 100;
  return (
    <div style={{ marginTop:6, position:"relative", height:5, background:"#F3F4F6", borderRadius:99, overflow:"hidden" }}>
      {/* threshold marker */}
      <div style={{ position:"absolute", left:`${trackPct}%`, top:0, bottom:0, width:2, background:"#E5E7EB", zIndex:2 }} />
      <div style={{ position:"absolute", left:0, top:0, height:"100%", width:`${width}%`, background:color, borderRadius:99, transition:"width 0.7s cubic-bezier(0.4,0,0.2,1)" }} />
    </div>
  );
}

// ─── SKIPPED BASELINE RESULTS ────────────────────────────────────────────────
function SkippedResults({ r, sc, onAddIncome, b }) {
  const meta = SCENARIO_META[sc.type];

  // Build a simple payment breakdown based on scenario type
  const lines = [];
  if(sc.type === "home") {
    if(r.mortgage)   lines.push(["Mortgage (P&I)",         r.mortgage]);
    if(sc.annualTax) lines.push(["Property Tax",           sc.annualTax/12]);
    const ins = sc.useDefaultIns ? sc.homePrice*0.0035 : sc.annualInsurance;
    if(ins)          lines.push(["Homeowners Insurance",   ins/12]);
    if(sc.hoaMonthly) lines.push(["HOA / Condo Fees", sc.hoaMonthly]);
    if(r.pmiApplies) lines.push(["PMI",                    r.pmiMonthly]);
  } else if(sc.type === "car") {
    lines.push(["Monthly Payment", r.scenarioCost]);
  } else if(sc.type === "job") {
    lines.push(["New Gross Salary", sc.newAnnualSalary/12]);
    if(sc.signingBonus) lines.push(["Signing Bonus", sc.signingBonus]);
  } else if(sc.type === "apt") {
    lines.push(["Monthly Rent", sc.newRent]);
    if(sc.securityDeposit) lines.push(["Security Deposit (one-time)", sc.securityDeposit]);
    if(sc.moveCosts)       lines.push(["Moving Costs (one-time)", sc.moveCosts]);
  }

  const totalMonthly = lines.filter(([l])=>!l.includes("one-time")).reduce((s,[,v])=>s+v,0);

  return (
    <div>
      {/* Payment breakdown card */}
      <div style={{ background:"#fff",border:"1.5px solid #F3F4F6",borderRadius:16,padding:"20px 22px",marginBottom:14 }}>
        <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:16 }}>
          <span style={{ fontSize:20 }}>{meta.emoji}</span>
          <div style={{ fontSize:10,fontWeight:800,letterSpacing:"0.1em",textTransform:"uppercase",color:"#9CA3AF" }}>
            {sc.type==="job" ? "New Salary Breakdown" : "Monthly Cost Breakdown"}
          </div>
        </div>
        <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
          {lines.map(([label, val])=>(
            <div key={label} style={{ display:"flex",justifyContent:"space-between",alignItems:"baseline" }}>
              <span style={{ fontSize:13,color:"#4B5563",fontWeight:600 }}>{label}</span>
              <span style={{ fontSize:14,fontWeight:800,fontFamily:"monospace",color:"#111" }}>{fmt(val)}{label.includes("one-time")?"":"/mo"}</span>
            </div>
          ))}
        </div>
        {lines.length > 1 && (
          <div style={{ borderTop:"1px solid #F3F4F6",marginTop:12,paddingTop:12,display:"flex",justifyContent:"space-between" }}>
            <span style={{ fontSize:13,fontWeight:800,color:"#111" }}>Total Monthly</span>
            <span style={{ fontSize:15,fontWeight:900,fontFamily:"monospace",color:"#111" }}>{fmt(totalMonthly)}/mo</span>
          </div>
        )}
      </div>

      {/* Income nudge */}
      <div style={{ background:"#F5F3FF",border:"1.5px solid #DDD6FE",borderRadius:16,padding:"20px 22px",marginBottom:14,textAlign:"center" }}>
        <div style={{ fontSize:22,marginBottom:10 }}>📊</div>
        <div style={{ fontSize:14,fontWeight:900,color:"#4338CA",marginBottom:6 }}>Can you actually afford this?</div>
        <div style={{ fontSize:13,color:"#6B7280",fontWeight:500,lineHeight:1.6,marginBottom:16 }}>
          Add your income and current expenses to see your full cash-flow analysis, surplus, and stress tests.
        </div>
        <button onClick={onAddIncome}
          style={{ background:"#4338CA",color:"#fff",border:"none",borderRadius:11,padding:"11px 24px",fontSize:13,fontWeight:800,cursor:"pointer",boxShadow:"0 4px 14px rgba(67,56,202,0.3)" }}>
          Add my income →
        </button>
      </div>

      {/* Affiliate links — always visible */}
      <LeadCapture sc={sc} r={r} b={b} />
    </div>
  );
}

function ResultsTab({ r, sc, ready, skipped, onAddIncome, scenarioReady, b }) {
  const rc=RISK_CFG[r.risk];
  const meta=SCENARIO_META[sc.type];
  const [mounted, setMounted] = useState(false);
  const [shared, setShared] = useState(false);
  const isSafe = r.risk === "SAFE";

  useEffect(() => { setMounted(false); const t = setTimeout(() => setMounted(true), 50); return () => clearTimeout(t); }, [r, ready]);

  // Plain-English summary — driven by the actual stress test signals
  const summary = (() => {
    const surplus = fmt(Math.abs(r.newSurplus));
    const run = mths(r.runway);

    // Helper: which stress test is the primary offender?
    // Returns a human-readable reason string for STRETCH or RISKY verdicts.
    const primaryReason = (() => {
      const isCarType = sc.type === "car";
      const ratioPass = r.ratio <= (isCarType ? 0.10 : 0.28);
      const ratioWarn = r.ratio <= (isCarType ? 0.15 : 0.35);
      const surplusPass = r.newSurplus > r.netIncome * 0.30;
      const surplusWarn = r.newSurplus > r.netIncome * 0.15;
      const runwayPass = r.runway >= 6;
      const runwayWarn = r.runway >= 3;
      const cashPass = r.remainingSavings > 5000;
      const cashWarn = r.remainingSavings > 0;

      // Priority: hard failures first, then warnings
      if(r.newSurplus < 0)      return `your expenses would exceed income by ${surplus}/mo`;
      if(!ratioWarn) {
        const label = sc.type==="car" ? "car cost" : sc.type==="apt" ? "rent" : "housing cost";
        return `${label} would be ${pct(r.ratio)} of take-home — above the ${isCarType?"15%":"35%"} ceiling`;
      }
      if(!runwayWarn)            return `closing costs would leave under 3 months of emergency runway`;
      if(!cashWarn)              return `you'd have negative savings after upfront costs`;
      if(!surplusWarn)           return `only ${fmt(r.newSurplus)}/mo would remain — below the 15% discretionary floor`;
      // Warnings (STRETCH zone)
      if(!ratioPass) {
        const label = sc.type==="car" ? "car cost" : sc.type==="apt" ? "rent" : "housing cost";
        return `${label} would be ${pct(r.ratio)} of take-home — slightly above the ${isCarType?"10%":"28%"} target`;
      }
      if(!runwayPass)            return `you'd have ${run} of emergency runway — below the 6-month target`;
      if(!surplusPass)           return `${fmt(r.newSurplus)}/mo surplus is below the recommended 30% of take-home`;
      if(!cashPass)              return `savings cushion after costs would be low`;
      return null;
    })();

    if(sc.type === "home") {
      if(r.risk==="SAFE")    return `At ${fmt(sc.homePrice)}, you'd have ${fmt(r.newSurplus)}/mo left over and ${run} of runway. Looks good.`;
      if(primaryReason)      return `At ${fmt(sc.homePrice)}, ${primaryReason}.`;
      return `At ${fmt(sc.homePrice)}, this is a stretch — the payment is high relative to your income.`;
    }
    if(sc.type === "car") {
      if(r.risk==="SAFE")    return `This adds ${fmt(r.scenarioCost)}/mo to your budget and leaves ${fmt(r.newSurplus)}/mo surplus. Affordable.`;
      if(primaryReason)      return `At ${fmt(r.scenarioCost)}/mo, ${primaryReason}.`;
      return `At ${fmt(r.scenarioCost)}/mo, the payment would strain your budget.`;
    }
    if(sc.type === "job") {
      const dir = r.salaryDelta >= 0 ? "up" : "down";
      return `Your take-home goes ${dir} by ${fmt(Math.abs(r.salaryDelta))}/mo. After expenses, you'd have ${fmt(r.newSurplus)}/mo surplus.`;
    }
    if(sc.type === "apt") {
      if(r.risk==="SAFE")    return `At ${fmt(sc.newRent)}/mo rent, you'd keep ${fmt(r.newSurplus)}/mo surplus. Comfortable.`;
      if(primaryReason)      return `At ${fmt(sc.newRent)}/mo, ${primaryReason}.`;
      return `At ${fmt(sc.newRent)}/mo, rent would exceed your comfortable range.`;
    }
    if(sc.type === "daycare") {
      if(r.risk==="SAFE")    return `Net daycare cost of ${fmt(r.netDaycareCost)}/mo leaves you with ${fmt(r.newSurplus)}/mo surplus. Manageable.`;
      if(primaryReason)      return `At ${fmt(r.netDaycareCost)}/mo net, ${primaryReason}.`;
      return `Daycare costs would leave your budget uncomfortably tight.`;
    }
    if(sc.type === "savings") {
      if(r.noBaseline) return `Enter your income in the Baseline tab to see how long it'll take to reach ${fmt(r.goal)}.`;
      if(r.targetMonths > 0 && r.requiredMonthly) {
        if(r.feasible) return `To hit ${fmt(r.goal)} in ${r.targetMonths} months, you need to set aside ${fmt(r.requiredMonthly)}/mo. Your surplus covers it.`;
        return `To hit ${fmt(r.goal)} in ${r.targetMonths} months you'd need ${fmt(r.requiredMonthly)}/mo — ${fmt(r.requiredMonthly - r.monthlySurplus)}/mo more than your current surplus.`;
      }
      if(r.atSurplusMonths) return `At a moderate savings pace (~${fmt(r.monthlySurplus * 0.5)}/mo), you'd reach ${fmt(r.goal)} in about ${r.moderateMonths || r.atSurplusMonths} months.`;
      return `Enter your income in the Baseline tab to see personalized timelines.`;
    }
    return "";
  })();

  const stressTests = [
    {
      label: sc.type==="job" ? "Expense-to-income ratio" : "Cost-to-income ratio",
      pass: r.ratio<=(sc.type==="car"?0.10:0.28),
      warn: r.ratio<=(sc.type==="car"?0.15:0.35),
      passThreshold: sc.type==="car"?0.10:0.28,
      warnThreshold: sc.type==="car"?0.15:0.35,
      ratio: r.ratio,
      note: sc.type==="car"
        ? `${pct(r.ratio)} of income on car — target ≤ 10%`
        : sc.type==="job"
        ? `${pct(r.ratio)} of income on total expenses`
        : `${pct(r.ratio)} of income — target ≤ 28%`,
    },
    {
      label:"Monthly surplus",
      pass:r.newSurplus > r.netIncome * 0.30, warn:r.newSurplus > r.netIncome * 0.15,
      passThreshold: 0, warnThreshold: 0, ratio: 0,
      note:r.newSurplus<0?"Negative — expenses exceed income"
        : r.newSurplus < r.netIncome * 0.30
          ? `${fmt(r.newSurplus)}/mo remaining — 30% of take-home (${fmt(r.netIncome*0.30)}) recommended for discretionary spending`
          : `${fmt(r.newSurplus)}/mo remaining`,
    },
    {
      label:"Emergency fund runway",
      pass:r.runway>=6, warn:r.runway>=3,
      passThreshold: 6/12, warnThreshold: 3/12,
      ratio: Math.min(r.runway/12, 1),
      note:`${mths(r.runway)} of expenses covered`,
    },
    {
      label: sc.type==="home"||sc.type==="apt" ? "Upfront cash check" : sc.type==="car" ? "Cash after purchase" : "Net one-time impact",
      pass: r.remainingSavings>5000, warn:r.remainingSavings>0,
      passThreshold: 0, warnThreshold: 0, ratio: 0,
      note: r.remainingSavings<0 ? "Insufficient savings" : `${fmt(r.remainingSavings)} remaining after costs`,
    },
  ];

  return (
    <div>
      {/* Scenario badge */}
      <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:14,padding:"9px 14px",background:`${meta.color}11`,border:`1.5px solid ${meta.color}33`,borderRadius:12,
        opacity:mounted?1:0,transform:mounted?"none":"translateY(-6px)",transition:"all 0.3s ease" }}>
        <span style={{ fontSize:18 }}>{meta.emoji}</span>
        <span style={{ fontSize:12,fontWeight:800,color:meta.color }}>{meta.label}</span>
      </div>

      {/* Not-ready prompt — scenario not filled in yet */}
      {!ready && !scenarioReady && (
        <div style={{ textAlign:"center",padding:"32px 20px",background:"#F9FAFB",border:"1.5px dashed #E5E7EB",borderRadius:18,marginBottom:14 }}>
          <div style={{ fontSize:28,marginBottom:12 }}>🧮</div>
          <div style={{ fontSize:15,fontWeight:800,color:"#374151",marginBottom:6 }}>Almost there</div>
          <div style={{ fontSize:13,color:"#9CA3AF",fontWeight:500,lineHeight:1.6 }}>
            {sc.type==="home" && "Enter a home price on the Scenario tab to see your analysis."}
            {sc.type==="car"  && "Enter a car price or payment on the Scenario tab to see your analysis."}
            {sc.type==="job"  && "Enter your new salary on the Scenario tab to see your analysis."}
            {sc.type==="apt"  && "Enter the new monthly rent on the Scenario tab to see your analysis."}
          </div>
        </div>
      )}

      {/* Skipped baseline — show payment breakdown + income nudge */}
      {!ready && scenarioReady && skipped && (
        <SkippedResults r={r} sc={sc} onAddIncome={onAddIncome} b={b} />
      )}

      {/* All results — only shown when ready */}
      {ready && (<>

      {/* ── VERDICT BANNER ── */}
      {/* Verdict banner — hidden for savings with no time constraint */}
      {!(r.type==="savings" && (!r.targetMonths || r.targetMonths===0)) ? (
      <div style={{ position:"relative",overflow:"hidden",background:rc.bg,border:`2px solid ${rc.border}`,borderRadius:20,padding:"22px 24px 20px",marginBottom:14,
        opacity:mounted?1:0,transform:mounted?"none":"scale(0.96)",transition:"all 0.4s cubic-bezier(0.34,1.56,0.64,1)" }}>
        <Confetti active={isSafe&&mounted} />
        <div style={{ position:"relative",zIndex:1 }}>
          <div style={{ fontSize:10,fontWeight:800,color:rc.color,opacity:0.6,letterSpacing:"0.16em",textTransform:"uppercase",marginBottom:8 }}>Verdict</div>
          <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:10 }}>
            <div style={{ fontSize:26,lineHeight:1,color:rc.color,opacity:0.5,fontWeight:300 }}>{rc.icon}</div>
            <div style={{ fontSize:40,fontWeight:900,color:rc.color,lineHeight:1,letterSpacing:"-0.02em" }}>{rc.label}</div>
          </div>
          <div style={{ fontSize:14,color:rc.color,opacity:0.8,fontWeight:500,lineHeight:1.6,borderTop:`1px solid ${rc.border}`,paddingTop:12 }}>{summary}</div>
        </div>
      </div>
      ) : (
      <div style={{ background:"#FFFBEB",border:"2px solid #FCD34D",borderRadius:20,padding:"22px 24px 20px",marginBottom:14,
        opacity:mounted?1:0,transform:mounted?"none":"scale(0.96)",transition:"all 0.4s cubic-bezier(0.34,1.56,0.64,1)" }}>
        <div style={{ fontSize:10,fontWeight:800,color:"#D97706",opacity:0.7,letterSpacing:"0.16em",textTransform:"uppercase",marginBottom:8 }}>Your Timeline</div>
        <div style={{ fontSize:22,fontWeight:900,color:"#D97706",lineHeight:1,letterSpacing:"-0.02em",marginBottom:10 }}>🎯 {fmt(r.goal)}</div>
        <div style={{ fontSize:14,color:"#92400E",fontWeight:500,lineHeight:1.6,borderTop:"1px solid #FDE68A",paddingTop:12 }}>{summary}</div>
      </div>
      )}

      {/* ── SHARE BUTTON ── */}
      {(()=>{
        const scenarioEmoji = r.type==="home" ? "🏠" : r.type==="car" ? "🚗" : r.type==="job" ? "💼" : r.type==="apt" ? "🏢" : r.type==="daycare" ? "👶" : r.type==="savings" ? "🎯" : "💰";
        const scenarioLabel = r.type==="home" ? "Can We Afford This House?" : r.type==="car" ? "Can We Afford This Car?" : r.type==="job" ? "Can We Afford This Job Change?" : r.type==="apt" ? "Can We Afford This Apartment?" : r.type==="daycare" ? "Can We Afford Daycare?" : r.type==="savings" ? "Savings Goal Planner" : "Can We Afford This?";

        let shareBody = "";
        if(r.type==="savings") {
          const timeline = r.targetMonths > 0
            ? `Required monthly: ${fmt(r.requiredMonthly)}\nTimeline: ${r.targetMonths} months`
            : r.atSurplusMonths
              ? `At full surplus: ${r.atSurplusMonths} months to goal`
              : "";
          shareBody = `Goal: ${fmt(r.goal)}\nVerdict: ${rc.label}\nMonthly surplus: ${fmt(r.monthlySurplus)}\n${timeline}`;
        } else if(r.type==="home" || r.type==="apt") {
          shareBody = `Verdict: ${rc.label}\nMonthly breathing room: ${fmt(r.newSurplus)}\nHousing ratio: ${pct(r.ratio)}\nEmergency runway: ${r.runway?.toFixed(1)} months`;
        } else if(r.type==="car") {
          shareBody = `Verdict: ${rc.label}\nMonthly breathing room: ${fmt(r.newSurplus)}\nCar as % of income: ${pct(r.ratio)}\nEmergency runway: ${r.runway?.toFixed(1)} months`;
        } else if(r.type==="job") {
          shareBody = `Verdict: ${rc.label}\nMonthly breathing room: ${fmt(r.newSurplus)}\nSalary change: ${r.salaryDelta >= 0 ? "+" : ""}${fmt(r.salaryDelta)}/yr\nEmergency runway: ${r.runway?.toFixed(1)} months`;
        } else if(r.type==="daycare") {
          shareBody = `Verdict: ${rc.label}\nNet daycare cost: ${fmt(r.netDaycareCost)}/mo\nMonthly breathing room: ${fmt(r.newSurplus)}\nEmergency runway: ${r.runway?.toFixed(1)} months`;
        } else {
          shareBody = `Verdict: ${rc.label}\nMonthly breathing room: ${fmt(r.newSurplus)}\nEmergency runway: ${r.runway?.toFixed(1)} months`;
        }

        const shareText = `${scenarioEmoji} ${scenarioLabel}\n\n${shareBody}\n\nRun your own scenario:\ncanweaffordthis.com`;
        const handleShare = () => {
          if(navigator.share) {
            navigator.share({ title: scenarioLabel, text: shareText })
              .then(()=>{ setShared(true); setTimeout(()=>setShared(false), 3000); })
              .catch(()=>{});
          } else {
            navigator.clipboard.writeText(shareText).then(()=>{
              setShared(true);
              setTimeout(()=>setShared(false), 3000);
            });
          }
        };
        return (
          <button onClick={handleShare} style={{
            width:"100%",padding:"12px 0",borderRadius:14,border:"1.5px solid #E5E7EB",
            background:shared?"#ECFDF5":"#fff",color:shared?"#059669":"#6B7280",
            fontSize:13,fontWeight:800,cursor:"pointer",transition:"all 0.2s",marginBottom:14,
            boxShadow:"0 1px 4px rgba(0,0,0,0.06)"
          }}>
            {shared ? "✔ Results copied. Send this to your partner." : "📤 Share Results"}
          </button>
        );
      })()}

      {/* Home-specific disclaimer */}
      {r.type==="home"&&(
        <div style={{ marginBottom:14, opacity:mounted?1:0, transform:mounted?"none":"translateY(8px)", transition:"all 0.4s ease 0.1s" }}>
          <InfoBox text="This figure only reflects changes to your housing cost. It does not account for potential increases to utilities, maintenance, or other household expenses when moving to a larger home." color="#4338CA" bg="#EEF2FF" border="#C7D2FE" />
        </div>
      )}

      {/* Job-specific callout */}
      {r.type==="job"&&(
        <div style={{ background:"#F5F3FF",border:"1.5px solid #C4B5FD",borderRadius:14,padding:"18px 20px",marginBottom:14,
          opacity:mounted?1:0,transform:mounted?"none":"translateY(8px)",transition:"all 0.4s ease 0.1s" }}>
          <div style={{ fontSize:10,fontWeight:800,color:"#7C3AED",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:14 }}>Job Change Summary</div>
          <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
            {[
              ["Old take-home",      fmt(r.oldNet)+"/mo"],
              ["New take-home",      fmt(r.netIncome)+"/mo"],
              ["Monthly income change", (r.salaryDelta>=0?"+":"")+fmt(r.salaryDelta)+"/mo"],
              r.netOneTime!==0&&["Net one-time impact", (r.netOneTime>=0?"+":"")+fmt(r.netOneTime)],
              r.breakEven>0&&["Break-even",`${r.breakEven} months`],
              r.breakEven===0&&r.netOneTime>=0&&["Break-even","Immediate — no upfront costs"],
            ].filter(Boolean).map(([l,v])=>(
              <div key={l} style={{ display:"flex",justifyContent:"space-between",alignItems:"baseline" }}>
                <span style={{ fontSize:13,color:"#4B5563",fontWeight:600 }}>{l}</span>
                <span style={{ fontSize:14,fontWeight:800,fontFamily:"monospace",color:"#5B21B6" }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daycare-specific callout */}
      {r.type==="daycare"&&(
        <div style={{ background:"#FDF2F8",border:"1.5px solid #FBCFE8",borderRadius:14,padding:"18px 20px",marginBottom:14,
          opacity:mounted?1:0,transform:mounted?"none":"translateY(8px)",transition:"all 0.4s ease 0.1s" }}>
          <div style={{ fontSize:10,fontWeight:800,color:"#DB2777",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:14 }}>Daycare Summary</div>
          <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
            {[
              ["Gross daycare cost",    fmt(r.grossDaycareCost)+"/mo"],
              r.fsaBenefit>0&&["FSA savings",           "-"+fmt(r.fsaBenefit)+"/mo"],
              ["Net daycare cost",      fmt(r.netDaycareCost)+"/mo"],
              r.lostIncome>0&&["Lost income",           "-"+fmt(r.lostIncome)+"/mo"],
            ].filter(Boolean).map(([l,v])=>(
              <div key={l} style={{ display:"flex",justifyContent:"space-between",alignItems:"baseline" }}>
                <span style={{ fontSize:13,color:"#4B5563",fontWeight:600 }}>{l}</span>
                <span style={{ fontSize:14,fontWeight:800,fontFamily:"monospace",color:"#DB2777" }}>{v}</span>
              </div>
            ))}
          </div>
          {r.worthWorking!==null&&(
            <div style={{ marginTop:14,paddingTop:12,borderTop:"1px solid #FBCFE8" }}>
              <div style={{ fontSize:12,fontWeight:800,color:"#DB2777",marginBottom:4 }}>Is it worth both of you working?</div>
              <div style={{ fontSize:13,color:"#4B5563",fontWeight:600,lineHeight:1.5 }}>
                {r.worthWorking
                  ? `✓ Yes — you net ${fmt(r.lostIncome - r.netDaycareCost)}/mo more by both working after daycare costs.`
                  : `✗ No — daycare costs (${fmt(r.netDaycareCost)}/mo) exceed the lost income (${fmt(r.lostIncome)}/mo). One parent staying home saves ${fmt(r.netDaycareCost - r.lostIncome)}/mo.`}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Savings-specific callout */}
      {r.type==="savings"&&(
        <div style={{ background:"#FFFBEB",border:"1.5px solid #FCD34D",borderRadius:14,padding:"18px 20px",marginBottom:14,
          opacity:mounted?1:0,transform:mounted?"none":"translateY(8px)",transition:"all 0.4s ease 0.1s" }}>
          <div style={{ fontSize:10,fontWeight:800,color:"#D97706",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:14 }}>Savings Breakdown</div>

          {/* Target months mode */}
          {r.targetMonths > 0 && r.requiredMonthly !== null && (
            <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
              {[
                ["Savings goal",        fmt(r.goal)],
                r.alreadySaved>0&&["Already saved",      fmt(r.alreadySaved)],
                ["Remaining",           fmt(r.remaining)],
                ["Target timeline",     `${r.targetMonths} months`],
                ["Required monthly",    fmt(r.requiredMonthly)+"/mo"],
                ["Your surplus",        fmt(r.monthlySurplus)+"/mo"],
              ].filter(Boolean).map(([l,v])=>(
                <div key={l} style={{ display:"flex",justifyContent:"space-between",alignItems:"baseline" }}>
                  <span style={{ fontSize:13,color:"#4B5563",fontWeight:600 }}>{l}</span>
                  <span style={{ fontSize:14,fontWeight:800,fontFamily:"monospace",color:"#D97706" }}>{v}</span>
                </div>
              ))}
              <div style={{ marginTop:8,paddingTop:10,borderTop:"1px solid #FCD34D",fontSize:13,fontWeight:700,
                color:r.feasible?"#059669":"#DC2626" }}>
                {r.feasible
                  ? `✓ Feasible — you'd have ${fmt(r.monthlySurplus - r.requiredMonthly)}/mo left over`
                  : `✗ Tight — you're ${fmt(r.requiredMonthly - r.monthlySurplus)}/mo short of this pace`}
              </div>
            </div>
          )}

          {/* No baseline income entered */}
          {r.noBaseline && (
            <div style={{ padding:"14px",background:"#FEF9C3",borderRadius:10,fontSize:13,fontWeight:700,color:"#92400E",textAlign:"center" }}>
              👆 Add your income in the Baseline tab to see your savings timeline
            </div>
          )}
          {(!r.targetMonths || r.targetMonths === 0) && !r.noBaseline && r.timelines.length > 0 && (
            <div>
              {r.atSurplusMonths&&(
                <div style={{ marginBottom:14,padding:"10px 14px",background:"#FEF9C3",borderRadius:10,fontSize:13,fontWeight:700,color:"#92400E" }}>
                  At your full surplus of {fmt(r.monthlySurplus)}/mo → {r.atSurplusMonths} months
                </div>
              )}
              <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
                {r.timelines.map(t=>(
                  <div key={t.label} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",
                    padding:"10px 14px",background:"#fff",borderRadius:10,border:"1px solid #FDE68A" }}>
                    <div>
                      <div style={{ fontSize:12,fontWeight:800,color:"#D97706" }}>{t.label}</div>
                      <div style={{ fontSize:11,color:"#9CA3AF",fontWeight:600 }}>{Math.round(t.pct*100)}% of surplus · {t.months} months</div>
                    </div>
                    <div style={{ fontSize:15,fontWeight:900,fontFamily:"monospace",color:"#111" }}>{fmt(t.monthly)}/mo</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Before → After — hidden for savings with no time constraint */}
      {!(r.type==="savings" && (!r.targetMonths || r.targetMonths===0)) && (
      <div style={{ background:"#fff",border:"1.5px solid #F3F4F6",borderRadius:16,padding:"20px 22px",marginBottom:14,
        opacity:mounted?1:0,transform:mounted?"none":"translateY(8px)",transition:"all 0.4s ease 0.15s" }}>
        <div style={{ fontSize:10,fontWeight:800,letterSpacing:"0.1em",textTransform:"uppercase",color:"#9CA3AF",marginBottom:16 }}>Monthly Cash Flow — Before vs. After</div>
        <div style={{ display:"grid",gridTemplateColumns:"1fr auto 1fr",gap:8,alignItems:"center",overflow:"hidden" }}>
          <div style={{ background:"#F9FAFB",borderRadius:12,padding:"12px 12px",minWidth:0,overflow:"hidden" }}>
            <div style={{ fontSize:10,color:"#9CA3AF",fontWeight:800,textTransform:"uppercase",letterSpacing:"0.07em" }}>Before</div>
            <div style={{ fontSize:16,fontWeight:900,color:"#111",fontFamily:"monospace",marginTop:5,whiteSpace:"nowrap" }}>
              <AnimatedMoney value={r.baselineSurplus} />
            </div>
            <div style={{ fontSize:11.5,color:"#6B7280",marginTop:3,fontWeight:600 }}>surplus/mo</div>
          </div>
          <div style={{ textAlign:"center",padding:"0 6px",display:"flex",flexDirection:"column",alignItems:"center",gap:4 }}>
            {/* Animated flowing arrow */}
            <div style={{ position:"relative",width:36,height:18,overflow:"hidden" }}>
              <svg width="36" height="18" viewBox="0 0 36 18" style={{ display:"block" }}>
                <defs>
                  <linearGradient id="arrowGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor={r.deltaSurplus<0?"#FCA5A5":"#6EE7B7"} stopOpacity="0.2"/>
                    <stop offset="100%" stopColor={r.deltaSurplus<0?"#DC2626":"#059669"} stopOpacity="1"/>
                  </linearGradient>
                </defs>
                <line x1="2" y1="9" x2="28" y2="9" stroke="url(#arrowGrad)" strokeWidth="2.5" strokeLinecap="round"
                  strokeDasharray="30" strokeDashoffset={mounted?"0":"30"}
                  style={{ transition:"stroke-dashoffset 0.6s ease 0.4s" }}/>
                <polyline points="22,4 30,9 22,14" fill="none" stroke={r.deltaSurplus<0?"#DC2626":"#059669"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  style={{ opacity:mounted?1:0, transition:"opacity 0.3s ease 0.8s" }}/>
              </svg>
            </div>
            <div style={{ fontSize:12,fontWeight:900,color:r.deltaSurplus<0?"#DC2626":"#059669",fontFamily:"monospace",whiteSpace:"nowrap" }}>
              {r.deltaSurplus>=0?"+":""}<AnimatedMoney value={r.deltaSurplus} />
            </div>
          </div>
          <div style={{ background:r.newSurplus<0?"#FEF2F2":r.newSurplus<r.netIncome*0.30?"#fef9c3":"#F0FDF4",border:`1.5px solid ${r.newSurplus<0?"#FCA5A5":r.newSurplus<r.netIncome*0.30?"#fde047":"#86EFAC"}`,borderRadius:12,padding:"12px 12px",minWidth:0,overflow:"hidden" }}>
            <div style={{ fontSize:10,color:"#9CA3AF",fontWeight:800,textTransform:"uppercase",letterSpacing:"0.07em" }}>After</div>
            <div style={{ fontSize:16,fontWeight:900,color:r.newSurplus<0?"#DC2626":r.newSurplus<r.netIncome*0.30?"#D97706":"#059669",fontFamily:"monospace",marginTop:5,whiteSpace:"nowrap" }}>
              <AnimatedMoney value={r.newSurplus} />
            </div>
            <div style={{ fontSize:11.5,color:"#6B7280",marginTop:3,fontWeight:600 }}>surplus/mo</div>
          </div>
        </div>
        <div style={{ marginTop:16,borderTop:"1px solid #F3F4F6",paddingTop:14,display:"flex",flexDirection:"column",gap:11 }}>
          {[
            ["Take-home income", fmt(r.netIncome)+"/mo", "#111"],
            [r.label+" ("+r.prevLabel+")", fmt(r.scenarioCost)+"/mo", r.ratio>(sc.type==="car"?0.15:0.35)?"#DC2626":r.ratio>(sc.type==="car"?0.10:0.28)?"#D97706":"#111"],
            ["Total monthly outflow", fmt(r.newTotal)+"/mo", "#111"],
            [sc.type==="job"?"Expense ratio":sc.type==="home"||sc.type==="apt"?"Housing as % of income":"Cost as % of income", pct(r.ratio), r.ratio>(sc.type==="car"?0.15:0.35)?"#DC2626":r.ratio>(sc.type==="car"?0.10:0.28)?"#D97706":"#059669"],
          ].map(([l,v,c])=>(
            <div key={l} style={{ display:"flex",justifyContent:"space-between",alignItems:"baseline" }}>
              <span style={{ fontSize:13,color:"#4B5563",fontWeight:600 }}>{l}</span>
              <span style={{ fontSize:14,fontWeight:800,fontFamily:"monospace",color:c }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
      )}

      {/* Cash + Runway */}
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14,
        opacity:mounted?1:0,transform:mounted?"none":"translateY(8px)",transition:"all 0.4s ease 0.2s" }}>
        <div style={{ background:"#fff",border:"1.5px solid #F3F4F6",borderRadius:14,padding:"18px" }}>
          <div style={{ fontSize:10,fontWeight:800,color:"#9CA3AF",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10 }}>
            {sc.type==="job"?"One-time Costs":"Cash Upfront"}
          </div>
          <div style={{ fontSize:22,fontWeight:900,fontFamily:"monospace",color:"#111" }}>
            <AnimatedMoney value={Math.abs(r.cashNeeded||r.netOneTime||0)} />
          </div>
          <div style={{ fontSize:12,color:"#6B7280",marginTop:3,fontWeight:600 }}>
            {sc.type==="home"?"down + closing":sc.type==="car"&&sc.carMode==="lease"?"due at signing":sc.type==="job"?(r.netOneTime<0?"net cost":"net gain"):"security + moving"}
          </div>
          <div style={{ marginTop:14,paddingTop:12,borderTop:"1px solid #F3F4F6" }}>
            <div style={{ fontSize:11,color:"#6B7280",fontWeight:600,marginBottom:3 }}>Savings after</div>
            <div style={{ fontSize:18,fontWeight:900,fontFamily:"monospace",color:r.remainingSavings<0?"#DC2626":"#111" }}>
              <AnimatedMoney value={r.remainingSavings} />
            </div>
          </div>
        </div>
        <div style={{ background:r.runway<3?"#FEF2F2":r.runway<6?"#FFFBEB":"#ECFDF5",border:`1.5px solid ${r.runway<3?"#FCA5A5":r.runway<6?"#FCD34D":"#6EE7B7"}`,borderRadius:14,padding:"18px" }}>
          <div style={{ fontSize:10,fontWeight:800,color:"#9CA3AF",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10 }}>Emergency Runway</div>
          <div style={{ fontSize:30,fontWeight:900,fontFamily:"monospace",color:r.runway<3?"#DC2626":r.runway<6?"#D97706":"#059669" }}>
            {mths(r.runway)}
          </div>
          <div style={{ fontSize:12,color:"#6B7280",fontWeight:600,marginTop:6,lineHeight:1.5 }}>
            {r.runway<3?"⚠ Below 3-month floor":r.runway<6?"⚡ Below 6-month target":"✓ Solid cushion"}
          </div>
        </div>
      </div>

      {/* Stress test with progress bars */}
      <div style={{ background:"#fff",border:"1.5px solid #F3F4F6",borderRadius:16,padding:"20px 22px",
        opacity:mounted?1:0,transform:mounted?"none":"translateY(8px)",transition:"all 0.4s ease 0.25s" }}>
        <div style={{ fontSize:10,fontWeight:800,letterSpacing:"0.1em",textTransform:"uppercase",color:"#9CA3AF",marginBottom:14 }}>Stress Test</div>
        <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
          {stressTests.map(({label,pass,warn,note,passThreshold,ratio:barRatio},i)=>{
            const s=pass?{bg:"#ECFDF5",dot:"#059669",tag:"#059669",tagBg:"#D1FAE5",tagLabel:"Pass"}
                   :warn?{bg:"#FFFBEB",dot:"#D97706",tag:"#D97706",tagBg:"#FEF3C7",tagLabel:"Watch"}
                   :     {bg:"#FEF2F2",dot:"#DC2626",tag:"#DC2626",tagBg:"#FEE2E2",tagLabel:"Flag"};
            return (
              <div key={label} style={{ padding:"12px 14px",background:s.bg,borderRadius:11,
                opacity:mounted?1:0,transform:mounted?"none":"translateX(-8px)",
                transition:`all 0.35s ease ${0.3+i*0.07}s` }}>
                <div style={{ display:"flex",alignItems:"center",gap:10 }}>
                  <div style={{
                    width:20,height:20,borderRadius:"50%",background:s.dot,flexShrink:0,
                    display:"flex",alignItems:"center",justifyContent:"center",
                    animation:mounted?`checkPop 0.4s cubic-bezier(0.34,1.56,0.64,1) ${0.5+i*0.09}s both`:"none",
                  }}>
                    <span style={{ fontSize:10,color:"#fff",fontWeight:900,lineHeight:1 }}>
                      {pass?"✓":warn?"!":"✕"}
                    </span>
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13,fontWeight:800,color:"#1F2937" }}>{label}</div>
                    <div style={{ fontSize:12,color:"#6B7280",marginTop:2,fontWeight:600 }}>{note}</div>
                  </div>
                  <div style={{ padding:"3px 10px",borderRadius:20,background:s.tagBg,fontSize:11,fontWeight:800,color:s.tag,whiteSpace:"nowrap" }}>{s.tagLabel}</div>
                </div>
                {barRatio > 0 && mounted && (
                  <StressBar ratio={barRatio} passThreshold={passThreshold} pass={pass} warn={warn} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Home monthly breakdown — home only */}
      {sc.type==="home"&&sc.homePrice>0&&(
        <div style={{ background:"#fff",border:"1.5px solid #F3F4F6",borderRadius:16,padding:"18px 20px",marginTop:14,
          opacity:mounted?1:0,transform:mounted?"none":"translateY(8px)",transition:"all 0.4s ease 0.3s" }}>
          <div style={{ fontSize:10,fontWeight:800,letterSpacing:"0.1em",textTransform:"uppercase",color:"#9CA3AF",marginBottom:12 }}>Monthly Payment Breakdown</div>
          {[
            ["Mortgage (P&I)", r.mortgage],
            ["Property Tax", sc.annualTax/12],
            ["Homeowners Insurance", (sc.useDefaultIns ? sc.homePrice*0.0035 : sc.annualInsurance)/12],
            ...(r.hoaMonthly > 0 ? [["HOA / Condo Fees", r.hoaMonthly]] : []),
            ...(r.pmiApplies ? [["PMI", r.pmiMonthly, "#D97706"]] : []),
          ].map(([label, val, color="#4B5563"])=>(
            <div key={label} style={{ display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:8 }}>
              <span style={{ fontSize:12,color,fontWeight:label==="PMI"?800:600,display:"flex",alignItems:"center",gap:5 }}>
                {label}
                {label==="PMI"&&<span style={{ fontSize:10,background:"#FEF9C3",color:"#92400E",fontWeight:800,padding:"1px 6px",borderRadius:5 }}>drops at 20% equity</span>}
              </span>
              <span style={{ fontSize:13,fontWeight:800,fontFamily:"monospace",color:label==="PMI"?"#D97706":"#111" }}>{fmt(val)}/mo</span>
            </div>
          ))}
          <div style={{ borderTop:"1px solid #F3F4F6",marginTop:8,paddingTop:10,display:"flex",justifyContent:"space-between" }}>
            <span style={{ fontSize:13,fontWeight:800,color:"#111" }}>Total Housing</span>
            <span style={{ fontSize:14,fontWeight:900,fontFamily:"monospace",color:"#111" }}>{fmt(r.scenarioCost)}/mo</span>
          </div>
        </div>
      )}

      {/* Safe range — home only */}
      {sc.type==="home"&&r.comfortPrice&&(
        <div style={{ background:"#fff",border:"1.5px solid #F3F4F6",borderRadius:16,padding:"20px 22px",marginTop:14,
          opacity:mounted?1:0,transform:mounted?"none":"translateY(8px)",transition:"all 0.4s ease 0.35s" }}>
          <div style={{ fontSize:10,fontWeight:800,letterSpacing:"0.1em",textTransform:"uppercase",color:"#9CA3AF",marginBottom:14 }}>What Could You Comfortably Afford?</div>
          {(()=>{
            const mC=sc.homePrice>r.stretchPrice?"#DC2626":sc.homePrice>r.comfortPrice?"#D97706":"#059669";
            const barMax=Math.max(sc.homePrice,r.stretchPrice)*1.18;
            const cP=Math.min(92,(r.comfortPrice/barMax)*100);
            const sP=Math.min(92,(r.stretchPrice/barMax)*100);
            const hP=Math.min(92,(sc.homePrice/barMax)*100);
            return (
              <>
                <div style={{ position:"relative",height:10,background:"#F3F4F6",borderRadius:99,marginBottom:32 }}>
                  <div style={{ position:"absolute",left:0,top:0,height:"100%",width:mounted?`${cP}%`:"0%",background:"linear-gradient(90deg,#A7F3D0,#34D399)",borderRadius:99,transition:"width 0.8s cubic-bezier(0.4,0,0.2,1) 0.4s" }} />
                  <div style={{ position:"absolute",left:`${cP}%`,top:0,height:"100%",width:mounted?`${Math.max(0,sP-cP)}%`:"0%",background:"linear-gradient(90deg,#FDE68A,#FBBF24)",transition:"width 0.8s cubic-bezier(0.4,0,0.2,1) 0.5s" }} />
                  <div style={{ position:"absolute",top:-5,left:`calc(${hP}% - 10px)`,width:20,height:20,borderRadius:"50%",background:mC,border:"3px solid #fff",boxShadow:`0 2px 10px ${mC}66`,transition:"left 0.6s cubic-bezier(0.34,1.56,0.64,1) 0.6s",zIndex:2 }} />
                  <div style={{ position:"absolute",top:16,left:`${cP}%`,transform:"translateX(-50%)",textAlign:"center",whiteSpace:"nowrap" }}>
                    <div style={{ fontSize:10,fontWeight:800,color:"#059669" }}>{fmt(r.comfortPrice)}</div>
                    <div style={{ fontSize:9,color:"#9CA3AF" }}>28%</div>
                  </div>
                  <div style={{ position:"absolute",top:16,left:`${sP}%`,transform:"translateX(-50%)",textAlign:"center",whiteSpace:"nowrap" }}>
                    <div style={{ fontSize:10,fontWeight:800,color:"#D97706" }}>{fmt(r.stretchPrice)}</div>
                    <div style={{ fontSize:9,color:"#9CA3AF" }}>35%</div>
                  </div>
                </div>
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8 }}>
                  {[
                    {lbl:"Comfortable",val:fmt(r.comfortPrice),sub:"≤ 28% income",color:"#059669",bg:"#ECFDF5",bdr:"#6EE7B7"},
                    {lbl:"Max Stretch", val:fmt(r.stretchPrice),sub:"≤ 35% income",color:"#D97706",bg:"#FFFBEB",bdr:"#FCD34D"},
                    {lbl:"Your Target", val:fmt(sc.homePrice),  sub:sc.homePrice<=r.comfortPrice?"✓ In range":sc.homePrice<=r.stretchPrice?"⚡ Stretch":"! Over",color:mC,bg:"#F9FAFB",bdr:"#E5E7EB"},
                  ].map(({lbl,val,sub,color,bg,bdr})=>(
                    <div key={lbl} style={{ background:bg,border:`1.5px solid ${bdr}`,borderRadius:12,padding:"13px 12px" }}>
                      <div style={{ fontSize:9,fontWeight:800,color:"#9CA3AF",letterSpacing:"0.07em",textTransform:"uppercase",marginBottom:5 }}>{lbl}</div>
                      <div style={{ fontSize:14,fontWeight:900,color,fontFamily:"monospace" }}>{val}</div>
                      <div style={{ fontSize:11,color:"#6B7280",fontWeight:600,marginTop:3 }}>{sub}</div>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </div>
      )}

      </>)}

      {ready && <LeadCapture sc={sc} r={r} b={b} />}

      {ready && <p style={{ textAlign:"center",fontSize:10.5,color:"#D1D5DB",marginTop:18,lineHeight:1.6 }}>
        Cash-flow analysis — not a loan approval estimate.<br />Consult a financial advisor before major decisions.
      </p>}
    </div>
  );
}

// ─── LEAD CAPTURE ─────────────────────────────────────────────────────────────
const LEAD_META = {
  home: {
    headline: "Ready to take the next step?",
    sub: "Connect with a mortgage professional or financial advisor.",
    partners: [
      { label:"Get mortgage rates", icon:"🏦", url:"https://www.bankrate.com/mortgages/mortgage-rates/", tag:"Mortgage Lender" },
      { label:"Find a financial advisor", icon:"📊", url:"https://www.nerdwallet.com/advisors", tag:"Financial Advisor" },
      { label:"Learn about home insurance", icon:"🛡️", url:"https://www.policygenius.com/homeowners-insurance/", tag:"Insurance" },
    ],
  },
  car: {
    headline: "Want help financing your next vehicle?",
    sub: "Compare auto loan rates or find the right coverage.",
    partners: [
      { label:"Compare auto loan rates", icon:"🚗", url:"https://www.bankrate.com/loans/auto-loans/", tag:"Auto Loan" },
      { label:"Get insurance quotes", icon:"🛡️", url:"https://www.policygenius.com/auto-insurance/", tag:"Auto Insurance" },
      { label:"Talk to a financial advisor", icon:"📊", url:"https://www.nerdwallet.com/advisors", tag:"Financial Advisor" },
    ],
  },
  job: {
    headline: "Making a career move?",
    sub: "Helpful tools for your job search and financial planning.",
    partners: [
      { label:"Update your resume", icon:"📄", url:"https://www.resumebuilder.com", tag:"Resume Builder" },
      { label:"Negotiate your offer", icon:"💼", url:"https://www.levels.fyi", tag:"Salary Data" },
      { label:"Review your benefits", icon:"📊", url:"https://www.nerdwallet.com/advisors", tag:"Financial Advisor" },
    ],
  },
  apt: {
    headline: "Ready to make your move?",
    sub: "Connect with resources to help with your next apartment.",
    partners: [
      { label:"Get renters insurance", icon:"🛡️", url:"https://www.policygenius.com/renters-insurance/", tag:"Renters Insurance" },
      { label:"Compare apartments", icon:"🏢", url:"https://www.apartments.com", tag:"Apartment Search" },
      { label:"Talk to a financial advisor", icon:"📊", url:"https://www.nerdwallet.com/advisors", tag:"Financial Advisor" },
    ],
  },
  daycare: {
    headline: "Planning for childcare costs?",
    sub: "Resources to help you navigate this stage of family finances.",
    partners: [
      { label:"Find daycare near you", icon:"👶", url:"https://www.care.com/child-care", tag:"Childcare Search" },
      { label:"Open a dependent care FSA", icon:"💰", url:"https://www.nerdwallet.com/article/taxes/dependent-care-fsa", tag:"Tax Savings" },
      { label:"Talk to a financial advisor", icon:"📊", url:"https://www.nerdwallet.com/advisors", tag:"Financial Advisor" },
    ],
  },
  savings: {
    headline: "Ready to start saving?",
    sub: "Tools to help you hit your goal faster.",
    partners: [
      { label:"Open a high-yield savings account", icon:"🏦", url:"https://www.bankrate.com/banking/savings/best-high-yield-interests-savings-accounts/", tag:"HYSA" },
      { label:"Talk to a financial advisor", icon:"📊", url:"https://www.nerdwallet.com/advisors", tag:"Financial Advisor" },
      { label:"Build an emergency fund", icon:"🛡️", url:"https://www.nerdwallet.com/article/banking/savings/how-to-build-an-emergency-fund", tag:"Emergency Fund" },
    ],
  },
};

function LeadCapture({ sc, r, b }) {
  const meta = LEAD_META[sc.type] || LEAD_META.home;

  // Smart mortgage link routing — only applies to home purchase scenario
  const mortgageUrl = sc.type === "home"
    ? b?.ownsHome === true
      ? "https://www.dpbolvw.net/click-101701917-17168360"   // existing homeowner → refi-rates
      : "https://www.tkqlhce.com/click-101701917-17168395"   // first-time buyer (no or skipped)
    : null;

  const partners = meta.partners.map(p =>
    (mortgageUrl && p.tag === "Mortgage Lender") ? { ...p, url: mortgageUrl } : p
  );
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | submitting | done | error
  const [hovered, setHovered] = useState(null);

  const handleSubmit = async () => {
    if(!email || !email.includes("@")) return;
    setStatus("submitting");
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          scenario: sc.type,
          risk: r.risk,
          timestamp: new Date().toISOString(),
        }),
      });
      if(!res.ok) throw new Error("failed");
      setStatus("done");
      if(typeof window.gtag !== "undefined") window.gtag("event", "lead_captured", { scenario: sc.type, risk: r.risk });
    } catch {
      setStatus("error");
    }
  };

  return (
    <div style={{ marginTop:20,background:"#F9FAFB",border:"1.5px solid #E5E7EB",borderRadius:20,padding:"24px 22px" }}>

      {status !== "done" ? (<>
        {/* Headline */}
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:15,fontWeight:900,color:"#111",marginBottom:4 }}>{meta.headline}</div>
          <div style={{ fontSize:13,color:"#6B7280",fontWeight:500 }}>{meta.sub}</div>
        </div>

        {/* Partner links */}
        <div style={{ display:"flex",flexDirection:"column",gap:8,marginBottom:20 }}>
          {partners.map((p,i) => (
            <a key={i} href={p.url} target="_blank" rel="noopener noreferrer"
              onClick={()=>{ if(typeof window.gtag !== "undefined") window.gtag("event", "affiliate_click", { partner: p.label, scenario: sc.type }); }}
              onMouseEnter={()=>setHovered(i)} onMouseLeave={()=>setHovered(null)}
              style={{ display:"flex",alignItems:"center",gap:12,padding:"12px 14px",
                background:hovered===i?"#fff":"#fff",
                border:`1.5px solid ${hovered===i?"#A5B4FC":"#E5E7EB"}`,
                borderRadius:12,textDecoration:"none",
                boxShadow:hovered===i?"0 2px 12px rgba(67,56,202,0.1)":"none",
                transform:hovered===i?"translateY(-1px)":"none",
                transition:"all 0.15s" }}>
              <span style={{ fontSize:20 }}>{p.icon}</span>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13,fontWeight:800,color:"#111" }}>{p.label}</div>
                <div style={{ fontSize:11,color:"#9CA3AF",fontWeight:600 }}>{p.tag}</div>
              </div>
              <span style={{ fontSize:12,color:"#A5B4FC",fontWeight:800 }}>→</span>
            </a>
          ))}
        </div>

        {/* Divider */}
        <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:16 }}>
          <div style={{ flex:1,height:1,background:"#E5E7EB" }} />
          <span style={{ fontSize:11,fontWeight:700,color:"#D1D5DB",textTransform:"uppercase",letterSpacing:"0.08em" }}>Stay in the loop</span>
          <div style={{ flex:1,height:1,background:"#E5E7EB" }} />
        </div>

        {/* Email capture */}
        <div style={{ fontSize:12,color:"#6B7280",fontWeight:500,marginBottom:10,lineHeight:1.5 }}>
          Get notified when we add new scenarios and features. No spam, ever.
        </div>
        <div style={{ display:"flex",gap:8 }}>
          <input type="email" placeholder="your@email.com" value={email}
            onChange={e=>setEmail(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&handleSubmit()}
            style={{ flex:1,padding:"11px 14px",border:"1.5px solid #E5E7EB",borderRadius:11,
              fontSize:14,fontFamily:"inherit",fontWeight:500,color:"#111",
              background:"#fff",outline:"none" }} />
          <button onClick={handleSubmit} disabled={status==="submitting"}
            style={{ padding:"11px 18px",background:"#4338CA",color:"#fff",border:"none",
              borderRadius:11,fontSize:13,fontWeight:800,cursor:"pointer",whiteSpace:"nowrap",
              opacity:status==="submitting"?0.7:1,transition:"all 0.15s" }}>
            {status==="submitting"?"...":"Notify me"}
          </button>
        </div>
        {status==="error"&&<div style={{ fontSize:12,color:"#DC2626",marginTop:8,fontWeight:600 }}>Something went wrong — try again.</div>}

      </>) : (
        /* Thank you state */
        <div style={{ textAlign:"center",padding:"8px 0" }}>
          <div style={{ fontSize:28,marginBottom:10 }}>🎉</div>
          <div style={{ fontSize:15,fontWeight:900,color:"#111",marginBottom:6 }}>You're on the list!</div>
          <div style={{ fontSize:13,color:"#6B7280",fontWeight:500,lineHeight:1.6,marginBottom:20 }}>
            We'll let you know when new features drop. In the meantime, check out one of these resources:
          </div>
          <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
            {partners.map((p,i) => (
              <a key={i} href={p.url} target="_blank" rel="noopener noreferrer"
                style={{ display:"flex",alignItems:"center",gap:12,padding:"12px 14px",
                  background:"#fff",border:"1.5px solid #E5E7EB",borderRadius:12,
                  textDecoration:"none",transition:"all 0.15s" }}>
                <span style={{ fontSize:20 }}>{p.icon}</span>
                <div style={{ flex:1,textAlign:"left" }}>
                  <div style={{ fontSize:13,fontWeight:800,color:"#111" }}>{p.label}</div>
                  <div style={{ fontSize:11,color:"#9CA3AF",fontWeight:600 }}>{p.tag}</div>
                </div>
                <span style={{ fontSize:12,color:"#A5B4FC",fontWeight:800 }}>→</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
const DEFAULT_B = {
  incomeMode:"gross", annualGross:0, netIncome:0,
  showPartnerIncome:false, partnerIncomeMode:"gross", partnerAnnualGross:0, partnerNetIncome:0,
  filingStatus:"married", state:"CT", savings:0, ownsHome:null,
  expenseMode:"simple",
  currentHousing:0, simpleOther:0, simpleTotal:0,
  carPayment:0, otherDebts:0, utilities:0, groceries:0, subscriptions:0, otherLiving:0,
};
const DEFAULT_SC_CLEAN = {
  type:"home",
  // home
  homePrice:0, downPayment:0, downPaymentPct:0, interestRate:6.8, loanTerm:30, annualTax:0,
  annualInsurance:0, useDefaultIns:true, closingCosts:0, useDefaultClose:true, pmiRate:0.85, useDefaultPmi:true, hoaMonthly:0,
  // car
  carMode:"buy", msrp:0, carDownPayment:0, tradeIn:0, carRate:6.9, carTerm:5,
  useKnownPayment:false, knownPayment:0, insuranceDelta:0,
  leaseMonthly:0, leaseTerm:36, leaseDownPayment:0,
  // job
  newAnnualSalary:0, signingBonus:0, relocationCosts:0,
  oldCommuteCost:0, newCommuteCost:0, benefitsCost:0,
  // apt
  newRent:0, securityDeposit:0, moveCosts:0,
  // daycare
  daycareChildren:1, daycareCostPerChild:0, daycareFSA:0, daycareLostIncome:0,
  // savings
  savingsGoal:0, savingsAlreadySaved:0, savingsTargetMonths:0,
};

export default function App() {
  const [tab,setTabRaw]=useState(0);
  const setTab = (v) => { const next = typeof v === "function" ? v(tab) : v; setTabRaw(next); window.scrollTo({top:0,behavior:"instant"}); };
  const [b,setB]    =useState(DEFAULT_B);
  const [sc,setSc]  =useState(DEFAULT_SC_CLEAN);
  const r=useMemo(()=>runCalcs(b,sc),[b,sc]);
  const hasIncome = b.annualGross > 0 || b.netIncome > 0;
  const scenarioReady = useMemo(()=>isScenarioReady(sc),[sc]);
  const ready=useMemo(()=>isReady(b,sc),[b,sc]);
  const th=THEME[TABS[tab]];
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        body{background:#F0F0EE;font-family:'Nunito',sans-serif;min-height:100vh;color-scheme:light;}
        input[type=number]{-moz-appearance:textfield;color-scheme:light;}
        input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;}
        button,select{font-family:'Nunito',sans-serif;color-scheme:light;}
        select{color-scheme:light;}
        ::-webkit-scrollbar{width:5px;}
        ::-webkit-scrollbar-thumb{background:#E0E0E0;border-radius:4px;}
        @keyframes spin{to{transform:rotate(360deg);}}
        @keyframes fadeSlideUp{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:translateY(0);}}
        @keyframes popIn{from{opacity:0;transform:scale(0.92);}to{opacity:1;transform:scale(1);}}
        @keyframes verdictPulse{0%,100%{box-shadow:0 8px 32px var(--verdict-glow)}50%{box-shadow:0 8px 52px var(--verdict-glow),0 0 0 8px var(--verdict-ring)}}
        @keyframes checkPop{0%{transform:scale(0) rotate(-20deg)}70%{transform:scale(1.2) rotate(4deg)}100%{transform:scale(1) rotate(0deg)}}
        @keyframes flowDash{from{stroke-dashoffset:30}to{stroke-dashoffset:0}}
        .tab-content{animation:fadeSlideUp 0.28s cubic-bezier(0.4,0,0.2,1);}
        .verdict-safe{--verdict-glow:#05966966;--verdict-ring:#6EE7B722;animation:verdictPulse 2.8s ease-in-out 0.5s 3;}
        .verdict-stretch{--verdict-glow:#D9770644;--verdict-ring:#FCD34D22;}
        .verdict-risky{--verdict-glow:#DC262644;--verdict-ring:#FCA5A522;}
      `}</style>
      <div style={{ minHeight:"100vh",padding:"52px 16px 64px",
        background:"radial-gradient(ellipse at 20% 0%,#e8e4ff 0%,transparent 60%),radial-gradient(ellipse at 80% 100%,#dff4ec 0%,transparent 60%),#F0F0EE",
        color:"#111" }}>
        <div style={{ maxWidth:520,margin:"0 auto" }}>
          {/* Header */}
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:28 }}>
            <div style={{ display:"flex",alignItems:"center",gap:10 }}>
              <img src="/logo-icon.png" alt="Can We Afford This?" style={{ width:130,height:130,objectFit:"contain" }} />
              <h1 style={{ fontSize:18,fontWeight:900,color:"#111",letterSpacing:"-0.03em",lineHeight:1.2 }}>Family Scenario<br />Simulator</h1>
            </div>
            <div style={{ display:"flex",alignItems:"center",gap:8 }}>
              <a href="https://blog.canweaffordthis.com" target="_blank" rel="noopener noreferrer"
                style={{ fontSize:12,fontWeight:800,color:"#6B7280",background:"#fff",border:"1.5px solid #E5E7EB",borderRadius:10,padding:"7px 14px",cursor:"pointer",transition:"all 0.15s",boxShadow:"0 1px 4px rgba(0,0,0,0.06)",textDecoration:"none" }}>
                📝 Blog
              </a>
              <button onClick={()=>{ setB(DEFAULT_B); setSc(DEFAULT_SC_CLEAN); setTab(0); }}
                style={{ fontSize:12,fontWeight:800,color:"#6B7280",background:"#fff",border:"1.5px solid #E5E7EB",borderRadius:10,padding:"7px 14px",cursor:"pointer",transition:"all 0.15s",boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}
                onMouseOver={e=>{e.currentTarget.style.borderColor="#9CA3AF";e.currentTarget.style.color="#374151";e.currentTarget.style.boxShadow="0 2px 8px rgba(0,0,0,0.1)";}}
                onMouseOut={e=>{e.currentTarget.style.borderColor="#E5E7EB";e.currentTarget.style.color="#6B7280";e.currentTarget.style.boxShadow="0 1px 4px rgba(0,0,0,0.06)";}}>
                ↺ Reset
              </button>
            </div>
          </div>
          {/* Intro */}
          <p style={{ fontSize:12,color:"#9CA3AF",fontWeight:600,textAlign:"center",marginBottom:16,marginTop:-8,letterSpacing:"0.01em" }}>
            Simulate how major life decisions impact your real monthly finances.
          </p>
          {/* Tabs */}
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:20 }}>
            {TABS.map((key,i)=>{
              const t=THEME[key],active=tab===i;
              const hasDot = (i===0&&(b.annualGross>0||b.netIncome>0))||(i===1&&sc.homePrice+sc.msrp+sc.newAnnualSalary+sc.newRent+(sc.daycareCostPerChild||0)+(sc.savingsGoal||0)>0)||(i===2);
              return (
                <button key={key} onClick={()=>setTab(i)} style={{
                  aspectRatio:"1/1",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:7,
                  borderRadius:20,border:"none",background:active?t.solid:"#fff",cursor:"pointer",transition:"all 0.22s cubic-bezier(0.34,1.56,0.64,1)",
                  boxShadow:active?`0 8px 24px ${t.glow},0 2px 6px rgba(0,0,0,0.08)`:"0 1px 4px rgba(0,0,0,0.06)",
                  transform:active?"translateY(-3px) scale(1.03)":"none",padding:0,position:"relative",
                }}>
                  <span style={{ fontSize:28 }}>{t.emoji}</span>
                  <span style={{ fontSize:12,fontWeight:900,color:active?t.text:"#C4C4C4" }}>{t.label}</span>
                  {i===0&&<span style={{ fontSize:9,color:active?"rgba(255,255,255,0.65)":"#D1D5DB",fontWeight:700 }}>skip if needed</span>}
                  {hasDot&&!active&&<div style={{ position:"absolute",top:10,right:10,width:7,height:7,borderRadius:"50%",background:t.solid,boxShadow:`0 0 6px ${t.solid}88` }} />}
                </button>
              );
            })}
          </div>
          {/* Card */}
          <div key={tab} className="tab-content" style={{ background:"#fff",borderRadius:22,border:"1.5px solid #ECECEC",padding:"26px 24px 30px",boxShadow:"0 4px 24px rgba(0,0,0,0.07),0 1px 4px rgba(0,0,0,0.04)" }}>
            {tab===0&&<BaselineTab b={b} setB={setB} />}
            {tab===1&&<ScenarioTab sc={sc} setSc={setSc} b={b} setB={setB} />}
            {tab===2&&<ResultsTab  r={r} sc={sc} ready={ready} skipped={!hasIncome} onAddIncome={()=>setTab(0)} scenarioReady={scenarioReady} b={b} />}
          </div>
          {/* Nav */}
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:16 }}>
            {tab>0?<button onClick={()=>setTab(t=>t-1)} style={{ background:"#fff",border:"1.5px solid #E5E7EB",borderRadius:11,padding:"10px 18px",fontSize:12.5,fontWeight:800,color:"#9CA3AF",cursor:"pointer",transition:"all 0.15s" }}
              onMouseOver={e=>e.currentTarget.style.borderColor="#9CA3AF"} onMouseOut={e=>e.currentTarget.style.borderColor="#E5E7EB"}>← Back</button>:<div/>}
            <div style={{ display:"flex",gap:6 }}>
              {TABS.map((_,i)=><button key={i} onClick={()=>setTab(i)} style={{ width:tab===i?26:7,height:7,borderRadius:99,background:tab===i?THEME[TABS[tab]].solid:"#E5E7EB",border:"none",cursor:"pointer",padding:0,transition:"all 0.22s" }} />)}
            </div>
            {tab<2?<button onClick={()=>setTab(t=>t+1)} style={{ background:th.solid,color:th.text,border:"none",borderRadius:11,padding:"10px 20px",fontSize:12.5,fontWeight:900,cursor:"pointer",boxShadow:`0 4px 14px ${th.glow}`,transition:"all 0.15s" }}
              onMouseOver={e=>e.currentTarget.style.opacity="0.88"} onMouseOut={e=>e.currentTarget.style.opacity="1"}>
              {tab===0?"Set Scenario →":"See Results →"}</button>:<div/>}
          </div>
        </div>
      </div>
    </>
  );
}
