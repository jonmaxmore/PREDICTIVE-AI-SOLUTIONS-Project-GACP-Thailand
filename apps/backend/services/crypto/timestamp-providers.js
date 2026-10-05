const TSA_PROVIDERS = {
  freetsa: {
    name: 'FreeTSA',
    url: 'https://freetsa.org/tsr',
    free: true,
    rateLimit: '10 requests/minute',
  },
  digicert: {
    name: 'DigiCert',
    url: 'https://timestamp.digicert.com',
    free: false,
    apiKey: process.env.DIGICERT_API_KEY,
  },
  globalsign: {
    name: 'GlobalSign',
    url: 'https://timestamp.globalsign.com/tsa/r6advanced1',
    free: false,
    apiKey: process.env.GLOBALSIGN_API_KEY,
  },
};

module.exports = {
  TSA_PROVIDERS,
};
