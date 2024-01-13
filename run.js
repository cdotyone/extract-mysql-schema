const fs = require("fs");
const path = require("path");
const { extractSchemas } = require('./index.js');

async function main(options) {
  const config = require(path.join(process.cwd(),options.configFile));
  const result = await extractSchemas(config.connection,options);

  if(options.writeSql){
    const done = [];
    let content = [];
    const seedContent = [];
    const sprocContent = [];
    const tableContent = [];

  	content.push(`CREATE DATABASE IF NOT EXISTS ${config.connection.database};\nUSE ${config.connection.database};`);

    const processFolder = function(seedPath,contentArray) {
      if(fs.existsSync(seedPath)) {
        fs.readdirSync(seedPath).forEach(file => {
          file = path.join(seedPath,file);
          if(done.indexOf(file)<0){
            contentArray.push(fs.readFileSync(file,"utf8"));
          }
        });
      }
    };

    const tablesPath=path.join(process.cwd(),"tables");
    tableContent.push(`USE ${config.connection.database};`);
    if(result[config.connection.database].tables.length>0) {
      // write table sql
      if (!fs.existsSync(tablesPath)){
        fs.mkdirSync(tablesPath);
      }
      const byName = {};
      result[config.connection.database].tables.forEach(table => {
        byName[table.name] = table.definition;
        let file = path.join(tablesPath,table.name+".sql");
        done.push(file);
        if(options.verbose) console.log("writing",file);
        fs.writeFileSync(file, table.definition ,"utf8")
      });

      result[config.connection.database].tableOrder.forEach(table => {
        tableContent.push(byName[table]);
      })
    }
    processFolder(tablesPath,tableContent); // add files not in the database

    const proceduresPath=path.join(process.cwd(),"procedures");
    sprocContent.push(`USE ${config.connection.database};`);
    if(result[config.connection.database].procedures.length>0) {
      // write routines
      if (!fs.existsSync(proceduresPath)){
        fs.mkdirSync(proceduresPath);
      }
      result[config.connection.database].procedures.forEach(proc => {
        let file = path.join(proceduresPath,proc.name+".sql");
        done.push(file);
        if(options.verbose) console.log("writing",file);
        fs.writeFileSync(file, proc.definition ,"utf8");
        sprocContent.push(proc.definition);
      });
    }
    processFolder(proceduresPath,sprocContent); // add files not in the database

    const seedPath = path.join(process.cwd(),"seed");
    seedContent.push(`USE ${config.connection.database};`);
    if(fs.existsSync(seedPath)) {
      result[config.connection.database].tableOrder.forEach(table => {
        let seedfile = path.join(seedPath,table+'.sql');
        if (fs.existsSync(seedfile)){
          done.push(seedfile);
          seedContent.push(fs.readFileSync(seedfile,"utf8"));
        }
      });
    }
    processFolder(seedPath,seedContent); // add files not in the database

    const patchContent=[];
    patchContent.push(`USE ${config.connection.database};`);
    processFolder(path.join(process.cwd(),"patch"), patchContent);

    if(content.length>0) {
      fs.writeFileSync(path.join(process.cwd(),"0.init.sql"), content.join('\n\n') ,"utf8");
    }
    if(tableContent.length>1) {
      fs.writeFileSync(path.join(process.cwd(),"1.table.sql"), tableContent.join('\n\n') ,"utf8");
    }
    if(seedContent.length>1) {
      fs.writeFileSync(path.join(process.cwd(),"2.seed.sql"), seedContent.join('\n\n') ,"utf8");
    }
    if(sprocContent.length>1) {
      fs.writeFileSync(path.join(process.cwd(),"3.procedures.sql"), sprocContent.join('\n\n') ,"utf8");
    }
    if(patchContent.length>1) {
      fs.writeFileSync(path.join(process.cwd(),"4.patch.sql"), patchContent.join('\n\n') ,"utf8");
    }

    content=content.concat(tableContent);
    content=content.concat(seedContent);
    content=content.concat(sprocContent);
    content=content.concat(patchContent);
    if(content.length>0) {
      fs.writeFileSync(path.join(process.cwd(),"init.sql"), content.join('\n\n') ,"utf8");
    }
  }

  if(options.outputFile) {
    fs.writeFileSync(path.join(process.cwd(),options.outputFile), JSON.stringify(result,null,2) ,"utf8")
  } else console.log(JSON.stringify(result,null,2));
}

let options = {
  configFile:"",
  outputFile:"",
  debug:false,
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
  else if(argv[i]==="--debug") options.debug=true;
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
    },(e)=>{
      console.log("ERROR",e);
      process.exit(1);
    })
} catch (e) {
    process.exit(1);
}
})();
