const fs = require("fs");
const path = require("path");
const { extractSchemas } = require('./index.js');

async function main(options) {
  const config = require(path.join(process.cwd(),options.configFile));
  const result = await extractSchemas(config.connection,options);

  if(options.writeSql){
    if(result[config.connection.database].tables.length>0) {
      // write table sql
      const tablesPath=path.join(process.cwd(),"tables")
      if (!fs.existsSync(tablesPath)){
        fs.mkdirSync(tablesPath);
      }
      result[config.connection.database].tables.forEach(table => {
        if(options.verbose) console.log("writing",path.join(tablesPath,table.name+".sql"));
        fs.writeFileSync(path.join(tablesPath,table.name+".sql"), table.definition ,"utf8")
      });
    }

    if(result[config.connection.database].procedures.length>0) {
      // write routines
      const proceduresPath=path.join(process.cwd(),"procedures")
      if (!fs.existsSync(proceduresPath)){
        fs.mkdirSync(proceduresPath);
      }
      result[config.connection.database].procedures.forEach(proc => {
        if(options.verbose) console.log("writing",path.join(proceduresPath,proc.name+".sql"));
        fs.writeFileSync(path.join(proceduresPath,proc.name+".sql"), proc.definition ,"utf8")
      });
    }

  }

  if(options.outputFile) {
    fs.writeFileSync(path.join(process.cwd(),options.outputFile), JSON.stringify(result,null,2) ,"utf8")
  } else console.log(JSON.stringify(result,null,2));
}

let options = {
  configFile:"",
  outputFile:"",
  columnISV:true,
  tableISV:false,
  procedureISV:false,
  writeSql:false
}

if (process.argv.length === 2) {
console.error('Expected at least one argument!');
process.exit(1);
} else {
let argv = process.argv;

for(let i=2;i<argv.length;i++) {
  if(argv[i]==="--columnISV") options.columnISV=true;
  else if(argv[i]==="--tableISV") options.tableISV=true;
  else if(argv[i]==="--procedureISV") options.procedureISV=true;
  else if(argv[i]==="--writeSql") options.writeSql=true;
  else
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