const TEST_DATABASE_NAME = 'sbms_test';
const TEST_DATABASE_USER = 'sbms_test_runner';
const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function refuse() {
  throw new Error(
    'Jest blocked: set NODE_ENV=test and configure DATABASE_URL and SBMS_TEST_DATABASE_URL to the same local sbms_test URL using the sbms_test_runner role.'
  );
}

const testDatabaseUrl = process.env.SBMS_TEST_DATABASE_URL;
const databaseUrl = process.env.DATABASE_URL;

if (process.env.NODE_ENV !== 'test' || !testDatabaseUrl || !databaseUrl || databaseUrl !== testDatabaseUrl) {
  refuse();
}

let parsedUrl;
try {
  parsedUrl = new URL(testDatabaseUrl);
} catch {
  refuse();
}

const hostname = parsedUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
let databaseName;
try {
  databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));
} catch {
  refuse();
}

if (
  !['postgres:', 'postgresql:'].includes(parsedUrl.protocol)
  || !LOCAL_DATABASE_HOSTS.has(hostname)
  || databaseName !== TEST_DATABASE_NAME
  || parsedUrl.username !== TEST_DATABASE_USER
  || parsedUrl.search
  || parsedUrl.hash
  || parsedUrl.pathname !== `/${TEST_DATABASE_NAME}`
) {
  refuse();
}
