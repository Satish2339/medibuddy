const isLocalFrontend = ["localhost", "127.0.0.1"].includes(window.location.hostname);

window.APP_CONFIG = {
  API_BASE_URL: isLocalFrontend
    ? `http://${window.location.hostname}:5000/api`
    : "/api"
};
