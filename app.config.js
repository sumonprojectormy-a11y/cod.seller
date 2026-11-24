module.exports = ({ config }) => {
  const firebase = process.env.GOOGLE_SERVICES_JSON;
  return {
    ...config,
    android: {
      ...config.android,
      ...(firebase ? { googleServicesFile: firebase } : {}),
    },
    extra: { ...config.extra, api: process.env.EXPO_PUBLIC_COD_API || 'https://www.cod.com.bd/api/v1/' },
  };
};
