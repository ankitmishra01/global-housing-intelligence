// FIPS 10-4 country codes (GDELT 1.0 ActionGeo_CountryCode) → ISO 3166-1 alpha-3.
// Territories without a World Bank economy are mapped where the World Bank lists one
// (e.g. Puerto Rico, Hong Kong, Macao) and otherwise omitted.
export const FIPS_TO_ISO3 = {
  AA: 'ABW', AC: 'ATG', AE: 'ARE', AF: 'AFG', AG: 'DZA', AJ: 'AZE', AL: 'ALB', AM: 'ARM', AN: 'AND', AO: 'AGO',
  AQ: 'ASM', AR: 'ARG', AS: 'AUS', AU: 'AUT', BA: 'BHR', BB: 'BRB', BC: 'BWA', BD: 'BMU', BE: 'BEL', BF: 'BHS',
  BG: 'BGD', BH: 'BLZ', BK: 'BIH', BL: 'BOL', BM: 'MMR', BN: 'BEN', BO: 'BLR', BP: 'SLB', BR: 'BRA', BT: 'BTN',
  BU: 'BGR', BX: 'BRN', BY: 'BDI', CA: 'CAN', CB: 'KHM', CD: 'TCD', CE: 'LKA', CF: 'COG', CG: 'COD', CH: 'CHN',
  CI: 'CHL', CJ: 'CYM', CM: 'CMR', CN: 'COM', CO: 'COL', CQ: 'MNP', CS: 'CRI', CT: 'CAF', CU: 'CUB', CV: 'CPV',
  CY: 'CYP', DA: 'DNK', DJ: 'DJI', DO: 'DMA', DR: 'DOM', EC: 'ECU', EG: 'EGY', EI: 'IRL', EK: 'GNQ', EN: 'EST',
  ER: 'ERI', ES: 'SLV', ET: 'ETH', EZ: 'CZE', FI: 'FIN', FJ: 'FJI', FM: 'FSM', FO: 'FRO', FP: 'PYF', FR: 'FRA',
  GA: 'GMB', GB: 'GAB', GG: 'GEO', GH: 'GHA', GI: 'GIB', GJ: 'GRD', GK: 'GGY', GL: 'GRL', GM: 'DEU', GQ: 'GUM',
  GR: 'GRC', GT: 'GTM', GV: 'GIN', GY: 'GUY', HA: 'HTI', HK: 'HKG', HO: 'HND', HR: 'HRV', HU: 'HUN', IC: 'ISL',
  ID: 'IDN', IM: 'IMN', IN: 'IND', IR: 'IRN', IS: 'ISR', IT: 'ITA', IV: 'CIV', IZ: 'IRQ', JA: 'JPN', JE: 'JEY',
  JM: 'JAM', JO: 'JOR', KE: 'KEN', KG: 'KGZ', KN: 'PRK', KR: 'KIR', KS: 'KOR', KT: 'CXR', KU: 'KWT', KV: 'XKX',
  KZ: 'KAZ', LA: 'LAO', LE: 'LBN', LG: 'LVA', LH: 'LTU', LI: 'LBR', LO: 'SVK', LS: 'LIE', LT: 'LSO', LU: 'LUX',
  LY: 'LBY', MA: 'MDG', MC: 'MAC', MD: 'MDA', MG: 'MNG', MH: 'MSR', MI: 'MWI', MJ: 'MNE', MK: 'MKD', ML: 'MLI',
  MN: 'MCO', MO: 'MAR', MP: 'MUS', MR: 'MRT', MT: 'MLT', MU: 'OMN', MV: 'MDV', MX: 'MEX', MY: 'MYS', MZ: 'MOZ',
  NC: 'NCL', NG: 'NER', NH: 'VUT', NI: 'NGA', NL: 'NLD', NO: 'NOR', NP: 'NPL', NR: 'NRU', NS: 'SUR', NU: 'NIC',
  NZ: 'NZL', OD: 'SSD', PA: 'PRY', PE: 'PER', PK: 'PAK', PL: 'POL', PM: 'PAN', PO: 'PRT', PP: 'PNG', PS: 'PLW',
  PU: 'GNB', QA: 'QAT', RI: 'SRB', RM: 'MHL', RN: 'MAF', RO: 'ROU', RP: 'PHL', RQ: 'PRI', RS: 'RUS', RW: 'RWA',
  SA: 'SAU', SB: 'SPM', SC: 'KNA', SE: 'SYC', SF: 'ZAF', SG: 'SEN', SI: 'SVN', SL: 'SLE', SM: 'SMR', SN: 'SGP',
  SO: 'SOM', SP: 'ESP', ST: 'LCA', SU: 'SDN', SV: 'SJM', SW: 'SWE', SY: 'SYR', SZ: 'CHE', TD: 'TTO', TH: 'THA',
  TI: 'TJK', TK: 'TCA', TN: 'TON', TO: 'TGO', TP: 'STP', TS: 'TUN', TT: 'TLS', TU: 'TUR', TV: 'TUV', TW: 'TWN',
  TX: 'TKM', TZ: 'TZA', UC: 'CUW', UG: 'UGA', UK: 'GBR', UP: 'UKR', US: 'USA', UV: 'BFA', UY: 'URY', UZ: 'UZB',
  VC: 'VCT', VE: 'VEN', VI: 'VGB', VM: 'VNM', VQ: 'VIR', VT: 'VAT', WA: 'NAM', WE: 'PSE', GZ: 'PSE', WS: 'WSM',
  WZ: 'SWZ', YM: 'YEM', ZA: 'ZMB', ZI: 'ZWE', NN: 'SXM',
};

export const fipsToIso3 = code => FIPS_TO_ISO3[code] || null;
