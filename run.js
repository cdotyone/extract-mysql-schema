const fs = require("fs");
const path = require("path");
const { extractSchemas } = require('./index.js');

async function main(options) {
  const config = require(path.join(process.cwd(),options.configFile));
  const result = await extractSchemas(config.connection);
  if(options.outputFile) {
    fs.writeFileSync(path.join(process.cwd(),options.outputFile), JSON.stringify(result,null,2) ,"utf8")
  } else console.log(JSON.stringify(result,null,2));
}

let options = {
  configFile:"",
  outputFile:"",
}

if (process.argv.length === 2) {
console.error('Expected at least one argument!');
process.exit(1);
} else {
let argv = process.argv;

for(let i=2;i<argv.length;i++) {
  if(argv[i].substring(0,2)==="--") {
      let name = argv[i].substring(2);
      if(options[name]!==undefined) {
          options[name] = argv[i+1];
          i++;
      } else {
          console.error('Expected a known option');
          process.exit(1);
      }
  }
}
}

(async () => {
try {
    console.log('\x1b[32m%s\x1b[0m',"Running with options:\n",JSON.stringify(options,null,2));
    main(options).then(()=>{
      if(options.debug) console.log("DONE");
      process.exit(0);
    },()=>{
      if(options.debug) console.log("ERROR");
      process.exit(1);
    })
} catch (e) {
    process.exit(1);
}
})();