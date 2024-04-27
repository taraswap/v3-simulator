import { calcUnboundedFees, getTickFromPrice, activeLiquidityForCandle, tokensFromLiquidity } from "./liquidity";
import { round, parsePrice } from "../numbers";

export const calcFees = (data, pool, baseID, liquidity, unboundedLiquidity, min, max, customFeeDivisor, leverage, investment, tokenRatio, hedging) => {

  return data.map((d, i) => {

    const fg = i - 1 < 0 ? [0, 0] : calcUnboundedFees(d.feeGrowthGlobal0X128, data[(i-1)].feeGrowthGlobal0X128, d.feeGrowthGlobal1X128, data[(i-1)].feeGrowthGlobal1X128, pool);

    const low = baseID === 0 ? d.low : 1 / (d.low === '0' ? 1 : d.low);
    const high = baseID === 0 ? d.high : 1 / (d.high === '0' ? 1 : d.high);

    const lowTick = getTickFromPrice(low, pool, baseID);
    const highTick = getTickFromPrice(high, pool, baseID);
    const minTick = getTickFromPrice(min, pool, baseID);
    const maxTick = getTickFromPrice(max, pool, baseID);

    const activeLiquidity = activeLiquidityForCandle(minTick, maxTick, lowTick, highTick);
    const tokens = tokensFromLiquidity((baseID === 1 ? 1 / d.close : d.close), min, max, liquidity, pool.token0.decimals, pool.token1.decimals);
    const feeToken0 = i === 0 ? 0 : fg[0] * liquidity * activeLiquidity / 100;
    const feeToken1 = i === 0 ? 0 : fg[1] * liquidity * activeLiquidity / 100;

    const feeUnb0 = i === 0 ? 0 : fg[0] * unboundedLiquidity;
    const feeUnb1 = i === 0 ? 0 : fg[1] * unboundedLiquidity;

    let fgV, feeV, feeUnb, amountV, feeUSD, amountTR;
    const latestRec = data[(data.length - 1)];
    const firstClose = baseID === 1 ? 1 / data[0].close : data[0].close;
    const currentClose =  baseID === 1 ? 1 / d.close : d.close;

    const tokenRatioFirstClose = tokensFromLiquidity(firstClose, min, max, liquidity, pool.token0.decimals, pool.token1.decimals);
    const x0 = tokenRatioFirstClose[1];
    const y0 = tokenRatioFirstClose[0];

     const impLossHedge = hedging.type === 'long' ? ( hedging.amount * hedging.leverage * ( (currentClose - firstClose) / firstClose) )  :
     hedging.type === 'short' ? ( hedging.amount * hedging.leverage * (( (currentClose - firstClose) / firstClose) * -1) )  : 0;

    if (baseID === 0) {
      fgV = i === 0 ? 0 : fg[0] + (fg[1] * d.close);
      feeV =  i === 0 ? 0 : feeToken0 + (feeToken1 * d.close);
      feeUnb =  i === 0 ? 0 : feeUnb0 + (feeUnb1 * d.close);
      amountV = tokens[0] + (tokens[1] * d.close);
      feeUSD = feeV * parseFloat(latestRec.pool.totalValueLockedUSD) / ((parseFloat(latestRec.pool.totalValueLockedToken1) * parseFloat(latestRec.close) ) + parseFloat(latestRec.pool.totalValueLockedToken0) );
      amountTR = (investment + (amountV - ((x0 * d.close) + y0))) + impLossHedge;
    }
    else if (baseID === 1) {
      fgV = i === 0 ? 0 : (fg[0] / d.close) + fg[1];
      feeV =  i === 0 ? 0 : (feeToken0  / d.close ) + feeToken1;
      feeUnb =  i === 0 ? 0 : feeUnb0 + (feeUnb1 * d.close);
      amountV = (tokens[1] / d.close) + tokens[0];
      feeUSD = feeV * parseFloat(latestRec.pool.totalValueLockedUSD) / (parseFloat(latestRec.pool.totalValueLockedToken1) + (parseFloat(latestRec.pool.totalValueLockedToken0) / parseFloat(latestRec.close)));
      amountTR = (investment + (amountV - ((x0 * (1 / d.close)) + y0))) + impLossHedge;
    }

    const date = new Date(d.periodStartUnix*1000);
    
    return {
      ...d,
      day: date.getUTCDate(),
      month: date.getUTCMonth(),
      year: date.getFullYear(), 
      fg0 : fg[0],
      fg1 : fg[1],
      activeliquidity: activeLiquidity,
      feeToken0: feeToken0,
      feeToken1: feeToken1,
      tokens: tokens,
      fgV: fgV,
      feeV: feeV / customFeeDivisor,
      feeUnb: feeUnb,
      amountV: amountV,
      amountTR: amountTR,
      feeUSD: feeUSD,
      close: d.close,
      baseClose: baseID === 1 ? 1 / d.close : d.close
    }

  });
}

// Pivot hourly estimated fee data (generated by calcFees) into daily values //
export const pivotFeeData = (data, baseID, investment, leverage, tokenRatio) => {

  const createPivotRecord = (date, data) => {
    return {
      date: `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${date.getFullYear()}`,
      day: date.getUTCDate(),
      month: date.getUTCMonth(),
      year: date.getFullYear(),
      feeToken0: data.feeToken0,
      feeToken1: data.feeToken1,
      feeV: data.feeV,
      feeUnb: data.feeUnb,
      fgV: parseFloat(data.fgV),
      feeUSD: data.feeUSD,
      activeliquidity: isNaN(data.activeliquidity) ? 0 : data.activeliquidity,
      amountV: data.amountV,
      amountTR: data.amountTR,
      amountVLast: data.amountV,
      percFee: data.feeV / data.amountV,
      close: data.close,
      baseClose: baseID === 1 ? 1 / data.close : data.close,
      count: 1
    }
    
  }
 
  const firstDate = new Date(data[0].periodStartUnix*1000);
  const pivot = [createPivotRecord(firstDate, data[0])];

  data.forEach((d, i) => {
    if (i > 0) {
      const currentDate = new Date(d.periodStartUnix * 1000);
      const currentPriceTick = pivot[(pivot.length - 1)];

      if ( currentDate.getUTCDate() === currentPriceTick.day && currentDate.getUTCMonth() === currentPriceTick.month && currentDate.getFullYear() === currentPriceTick.year) {    
        
        currentPriceTick.feeToken0 = currentPriceTick.feeToken0 + d.feeToken0;
        currentPriceTick.feeToken1 = currentPriceTick.feeToken1 + d.feeToken1;
        currentPriceTick.feeV = currentPriceTick.feeV + d.feeV;
        currentPriceTick.feeUnb = currentPriceTick.feeUnb + d.feeUnb;
        currentPriceTick.fgV = parseFloat(currentPriceTick.fgV) + parseFloat(d.fgV);
        currentPriceTick.feeUSD = currentPriceTick.feeUSD + d.feeUSD;
        currentPriceTick.activeliquidity = currentPriceTick.activeliquidity + d.activeliquidity;
        currentPriceTick.amountVLast = d.amountV;
        currentPriceTick.count = currentPriceTick.count + 1;

        if (i === (data.length - 1)) {
          currentPriceTick.activeliquidity = currentPriceTick.activeliquidity / currentPriceTick.count;
          currentPriceTick.percFee = currentPriceTick.feeV / currentPriceTick.amountV * 100;
        }
      }
      else {
        currentPriceTick.activeliquidity = currentPriceTick.activeliquidity / currentPriceTick.count;
        currentPriceTick.percFee = currentPriceTick.feeV / currentPriceTick.amountV * 100;
        pivot.push(createPivotRecord(currentDate, d));
      }
    }
  });

  // pivot.forEach(d => {
  //   console.log(d.date, "-", d.feeUSD, "-", d.activeliquidity)
  // })

  return pivot;
}


export const backtestIndicators = (data, investment, customCalc, hedging) => {

  let feeRoi = 0, token0Fee = 0, token1Fee = 0, feeUSD = 0, activeliquidity = 0, feeV = 0;
  if (data && data.length) {

    data.forEach((d, i) => {
      feeRoi += d.feeV;
      token0Fee += d.feeToken0;
      token1Fee += d.feeToken1;
      feeV += d.feeV;
      feeUSD += d.feeUSD;
      activeliquidity += d.activeliquidity;
    });
  
    feeRoi = customCalc ? feeV / (investment + hedging.amount) * 100 : feeV / (data[0].amountV + hedging.amount) * 100;
    activeliquidity = activeliquidity / data.length;
    const apr = feeRoi * 365 / data.length;
    const asset =  ((data[(data.length - 1)].amountV - data[0].amountV) / data[0].amountV) * 100;
    const total = feeRoi + asset;
    const confidence = activeliquidity === 100 ? "Very High" : activeliquidity > 80 ? "High" : activeliquidity > 40 ? "Medium" : "Low";

    return {feeV: feeV, feeroi: round(feeRoi, 2), apr: round(apr, 2), token0Fee: parsePrice(token0Fee), token1Fee: parsePrice(token1Fee), feeUSD: customCalc ? round(feeV, 2) : round(feeUSD, 2), activeliquidity: parseInt(activeliquidity), assetval: parsePrice(asset), total: parsePrice(total), confidence: confidence};
  }

  return {}
}