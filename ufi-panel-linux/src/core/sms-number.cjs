'use strict';
function smsNumber(input = {}) {
  if (typeof input.number !== 'string' || input.number.length > 64 || /[\r\n]/.test(input.number)) throw new Error('请填写一个收件号码');
  const number = input.number.trim().replace(/[ ()-]/g, '');
  const mode = input.numberMode || 'original';
  if (!['original', 'international'].includes(mode)) throw new Error('无效号码格式');
  let result = number;
  if (!number.startsWith('+') && mode === 'international') {
    if (!/^\+?[1-9]\d{0,2}$/.test(input.countryCode || '')) throw new Error('请选择国家／地区或填写 1–3 位区号');
    if (!/^\d+$/.test(number)) throw new Error('区号后的号码只能包含数字');
    result = '+' + input.countryCode.replace(/^\+/, '') + number;
  }
  if (result.startsWith('+')) {
    if (!/^\+[1-9]\d{3,14}$/.test(result)) throw new Error('国际号码须为 + 开头，总计 4–15 位数字');
  } else if (!/^\d{3,20}$/.test(result)) throw new Error('请填写本地／服务号码，或 +国家区号开头的国际号码');
  return result;
}
module.exports = { smsNumber };
