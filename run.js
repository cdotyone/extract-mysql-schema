const { extractSchemas } = require('./index.js');

async function run() {
  const connection = {
    host: '127.0.0.1',
    database: 'db',
    user: 'root',
    password: 'password',
  };

  const result = await extractSchemas(connection);

  console.log(JSON.stringify(result,null,2));
}

run();