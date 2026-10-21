// Search labels include Chinese, English and ISO region codes. Shared codes keep separate regions.
export const CALLING_CODES = [
 ['CN','中国大陆','China','86'],['HK','中国香港','Hong Kong','852'],['MO','中国澳门','Macao','853'],['TW','中国台湾','Taiwan','886'],
 ['US','美国','United States USA','1'],['CA','加拿大','Canada','1'],['GB','英国','United Kingdom UK','44'],['IE','爱尔兰','Ireland','353'],
 ['JP','日本','Japan','81'],['KR','韩国','South Korea','82'],['SG','新加坡','Singapore','65'],['MY','马来西亚','Malaysia','60'],['TH','泰国','Thailand','66'],['VN','越南','Vietnam','84'],['ID','印度尼西亚','Indonesia','62'],['PH','菲律宾','Philippines','63'],['IN','印度','India','91'],['PK','巴基斯坦','Pakistan','92'],['BD','孟加拉国','Bangladesh','880'],['LK','斯里兰卡','Sri Lanka','94'],['NP','尼泊尔','Nepal','977'],
 ['AU','澳大利亚','Australia','61'],['NZ','新西兰','New Zealand','64'],['DE','德国','Germany','49'],['FR','法国','France','33'],['IT','意大利','Italy','39'],['ES','西班牙','Spain','34'],['PT','葡萄牙','Portugal','351'],['NL','荷兰','Netherlands','31'],['BE','比利时','Belgium','32'],['CH','瑞士','Switzerland','41'],['AT','奥地利','Austria','43'],['SE','瑞典','Sweden','46'],['NO','挪威','Norway','47'],['DK','丹麦','Denmark','45'],['FI','芬兰','Finland','358'],['PL','波兰','Poland','48'],['CZ','捷克','Czechia','420'],['GR','希腊','Greece','30'],['HU','匈牙利','Hungary','36'],['RO','罗马尼亚','Romania','40'],['RU','俄罗斯','Russia','7'],['KZ','哈萨克斯坦','Kazakhstan','7'],['UA','乌克兰','Ukraine','380'],['TR','土耳其','Turkey','90'],
 ['AE','阿联酋','United Arab Emirates UAE','971'],['SA','沙特阿拉伯','Saudi Arabia','966'],['IL','以色列','Israel','972'],['QA','卡塔尔','Qatar','974'],['IR','伊朗','Iran','98'],['EG','埃及','Egypt','20'],['ZA','南非','South Africa','27'],['NG','尼日利亚','Nigeria','234'],['KE','肯尼亚','Kenya','254'],['MA','摩洛哥','Morocco','212'],
 ['MX','墨西哥','Mexico','52'],['BR','巴西','Brazil','55'],['AR','阿根廷','Argentina','54'],['CL','智利','Chile','56'],['CO','哥伦比亚','Colombia','57'],['PE','秘鲁','Peru','51'],
].map(([id, name, english, code]) => ({ id, name, english, code }));
export function searchCallingCodes(query) {
  const q = query.trim().toLowerCase().replace(/^\+/, '');
  return CALLING_CODES.filter(item => `${item.name} ${item.english} ${item.id} ${item.code}`.toLowerCase().includes(q));
}
