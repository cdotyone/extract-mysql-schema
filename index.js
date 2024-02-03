"use strict";
const SequelizeAdapter = require("sequelize");
const orderBy = require("lodash.orderby");

const spaceTabs = function(list) {
    const cols=[];
    let lines = [];
    list.forEach((line)=>{
        let line_cols = line.split('\t');
        for(let i=0;i<line_cols.length;i++) {
            let col = line_cols[i].trim();
            cols[i]=cols[i]||0;
            if(col.length>cols[i])
                cols[i]=col.length;
        }
    });

    list.forEach((line)=>{
        let line_cols = line.split('\t');
        for(let i=0;i<line_cols.length-1;i++) {
            line_cols[i] = line_cols[i].trim().padEnd(cols[i]+1);//+'('+(cols[i]+1)+')';
        }
        lines.push(line_cols.join(''));
    });

    return lines;
}


const getAdapter = async function (connection) {
    let adapter = new SequelizeAdapter(connection.database, connection.user, connection.password, {
        host: connection.Host,
        dialect: "mysql",
        logging: false,
        pool: {
            max: 5,
            min: 0,
            idle: 10000
        }
    });
    return adapter;
}

const extractSchemas = async function (connection, options) {
    const schemaName = connection.database;
    options = options || {};

    let adapter = await getAdapter(connection);

    let queryProcedures = await adapter.query(`
    SELECT * FROM INFORMATION_SCHEMA.ROUTINES where ROUTINE_SCHEMA = '${schemaName}'
    `);
    queryProcedures=queryProcedures[0];

    let queryParameters = await adapter.query(`
    SELECT p.* FROM INFORMATION_SCHEMA.PARAMETERS as p join INFORMATION_SCHEMA.ROUTINES as r on p.SPECIFIC_NAME=r.SPECIFIC_NAME and p.SPECIFIC_SCHEMA=r.ROUTINE_SCHEMA
    WHERE ROUTINE_SCHEMA='${schemaName}'
    ORDER BY p.SPECIFIC_NAME,p.ORDINAL_POSITION
    `);
    queryParameters=queryParameters[0];

    let queryFkey = await adapter.query(`
    SELECT iif.*, iifc.FOR_COL_NAME, iifc.REF_COL_NAME
    FROM INFORMATION_SCHEMA.INNODB_FOREIGN as iif
    JOIN INFORMATION_SCHEMA.INNODB_FOREIGN_COLS as iifc on iifc.ID=iif.ID
    WHERE iif.ID LIKE '${schemaName}/%'
    `);
    queryFkey=queryFkey[0];

    let queryIndexes = await adapter.query(`
    select
        T2.TABLE_SCHEMA,T2.TABLE_NAME,I.NAME as INDEX_NAME,
        C.COLUMN_TYPE as FIELD_TYPE,
        F.POS,I.TYPE,I.*,
        CASE WHEN I.TYPE=2 OR I.TYPE=3 THEN 'YES' ELSE 'NO' END AS IS_UNIQUE,
        CASE WHEN I.TYPE=3 THEN 'YES' ELSE 'NO' END AS IS_PRIMARY,
        CASE WHEN I.TYPE=0 THEN (CASE WHEN iif.id is not null THEN 'YES' ELSE 'NO' END) ELSE 'NO' END AS IS_FK,
        CASE WHEN C.EXTRA='auto_increment' THEN 'YES' ELSE 'NO' END AS IS_AUTONUMBER,
        F2.INDEX_KEYS as FIELD_NAME
    FROM INFORMATION_SCHEMA.INNODB_INDEXES I
    JOIN INFORMATION_SCHEMA.INNODB_FIELDS F on F.INDEX_ID=I.INDEX_ID
    JOIN (
        SELECT group_concat(FF.NAME ORDER BY FF.POS) as INDEX_KEYS,FF.INDEX_ID
        FROM INFORMATION_SCHEMA.INNODB_FIELDS as FF
        GROUP BY FF.INDEX_ID
    ) as F2 ON F2.INDEX_ID=F.INDEX_ID
    JOIN INFORMATION_SCHEMA.INNODB_TABLES T1 ON T1.TABLE_ID=I.TABLE_ID
	LEFT JOIN INFORMATION_SCHEMA.INNODB_FOREIGN as iif on iif.id= concat('${schemaName}','/',I.NAME)
    LEFT JOIN INFORMATION_SCHEMA.TABLES T2 ON T1.NAME=CONCAT(T2.TABLE_SCHEMA,'/',T2.TABLE_NAME)
    JOIN information_schema.COLUMNS C on C.TABLE_SCHEMA=T2.TABLE_SCHEMA and C.TABLE_NAME=T2.TABLE_NAME and C.COLUMN_NAME=F.NAME
    WHERE T2.TABLE_SCHEMA = '${schemaName}' and F.POS=0
    ORDER BY T2.TABLE_SCHEMA,T2.TABLE_NAME,I.NAME,F.POS
    `);
    queryIndexes=queryIndexes[0];

    let queryColumns = await adapter.query(`
    SELECT T.TABLE_TYPE,C.*,
    CASE WHEN EXISTS(SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS C2 WHERE C2.TABLE_SCHEMA=C.TABLE_SCHEMA and C2.TABLE_NAME=C.TABLE_NAME AND C2.COLUMN_KEY='PRI' AND C.COLUMN_KEY='PRI' AND C2.COLUMN_NAME<>C.COLUMN_NAME) THEN 'YES' ELSE 'NO' END AS IS_COMPOUND_KEY
    ,TP.PARTITION_METHOD,TP.PARTITION_EXPRESSION
	FROM INFORMATION_SCHEMA.COLUMNS C
    LEFT JOIN INFORMATION_SCHEMA.TABLES T ON T.TABLE_SCHEMA=C.TABLE_SCHEMA AND T.TABLE_NAME=C.TABLE_NAME
	LEFT JOIN INFORMATION_SCHEMA.PARTITIONS TP ON TP.TABLE_SCHEMA=C.TABLE_SCHEMA AND TP.TABLE_NAME=C.TABLE_NAME AND TP.PARTITION_NAME IS NOT NULL
    where C.TABLE_SCHEMA ='${schemaName}'
    order by C.TABLE_NAME,C.ORDINAL_POSITION
    `);
    queryColumns = queryColumns[0];

    await adapter.close();

    const foreign = {};
    for(let i=0;i<queryFkey.length;i++) {
        const tableName = queryFkey[i]['FOR_NAME'].substring(schemaName.length+1);
        const keyName = queryFkey[i]['ID'].substring(schemaName.length+1);
        foreign[tableName+"_"+queryFkey[i]['FOR_COL_NAME']] = {
            "schemaName": schemaName,
            "tableName": queryFkey[i]['REF_NAME'].substring(schemaName.length+1),
            "columnName": queryFkey[i]['FOR_COL_NAME'],
            "onUpdate": "CASCADE",
            "onDelete": "RESTRICT",
            "name": keyName
          };
    }

    let schema = {};
    let wrappers = {};
    let tables = [];
    let views = [];
    let hasParent = [];
    for (let i = 0; i < queryColumns.length; i++) {
        let name = queryColumns[i]['COLUMN_NAME'];

        let tableName = queryColumns[i]['TABLE_NAME'];
        let table = [];
        let definition = [];
        let wrapper = {};
        if (schema[tableName]) {
            table = schema[tableName];
            wrapper = wrappers[tableName];
            definition = wrapper.definition;
        } else {
            schema[tableName] = table;
            if(queryColumns[i]['TABLE']==="VIEW"){
                wrapper = {
                    name: tableName,
                    schemaName: schemaName,
                    kind: "view",
                    columns: table,
                    definition,
                    informationSchemaValue: {
                        table_type: 'VIEW',
                        table_catalog: schemaName,
                        table_name: tableName,
                        table_schema: schemaName
                    }
                };
                wrappers[tableName] = wrapper;
                views.push(wrapper);
            } else {
                wrapper = {
                    name: tableName,
                    schemaName: schemaName,
                    kind: "table",
                    columns: table,
                    definition,
                    informationSchemaValue: {
                        is_insertable_into: 'YES',
                        table_type: 'BASE',
                        table_catalog: schemaName,
                        table_name: tableName,
                        table_schema: schemaName,
                    }
                };
                wrappers[tableName] = wrapper;
                tables.push(wrapper);
            }
        }

        let column = {
            name: name,
            ordinalPosition: queryColumns[i]['ORDINAL_POSITION'],
            sqltype: queryColumns[i]['COLUMN_TYPE'],
            maxLength: queryColumns[i]['CHARACTER_MAXIMUM_LENGTH'],
            isPrimaryKey: queryColumns[i]['COLUMN_KEY'] === 'PRI',
            isCompoundKey: queryColumns[i]['IS_COMPOUND_KEY'] === 'YES',
            isNullable: queryColumns[i]['IS_NULLABLE'] === 'YES',
            isAutoNumber: queryColumns[i]['EXTRA'] === 'auto_increment',
            generated: queryColumns[i]['EXTRA'].indexOf('STORED GENERATED') >=0 ? "STORED" : (
				queryColumns[i]['EXTRA'].indexOf('DEFAULT_GENERATED') >= 0 ? (queryColumns[i]['EXTRA'].indexOf('on update') > 0 ? "ALWAYS" : "BY DEFAULT") : "NEVER"
			),
			expression: queryColumns[i]['GENERATION_EXPRESSION'] !== '' ? queryColumns[i]['GENERATION_EXPRESSION'].replace(/\\'/g,"'") : null,
			isUpdatable: queryColumns[i]['EXTRA'].indexOf('DEFAULT_GENERATED') < 0 && queryColumns[i]['EXTRA'].indexOf('STORED GENERATED') < 0,
            type: queryColumns[i]['DATA_TYPE'],
            defaultValue: queryColumns[i]['COLUMN_DEFAULT'] || "",
            references:[]
        };
        let extra = queryColumns[i]['EXTRA']||"";
        extra=extra.replace(/STORED GENERATED\w?/g,'').replace(/DEFAULT_GENERATED\w?/g,'').replace(/auto_increment\w?/g,'');
        let def = column.defaultValue?(column.defaultValue):"";
        if(def!=="CURRENT_TIMESTAMP" && def) {
            if(def.indexOf('(')>0) def=`(${def})`;
            else if(column.type.indexOf('char')>=0 || column.type.indexOf('text')>=0) {
                if(def.indexOf("'")>=0) def='('+def.replace(/\\'/g,"'")+')';
                else def=`('${def}')`;
            }
        }
		if(wrapper.partition===undefined && queryColumns[i]['PARTITION_METHOD']!==null) wrapper.partition=`PARTITION BY ${queryColumns[i]['PARTITION_METHOD']}(${queryColumns[i]['PARTITION_EXPRESSION']})`;
        if(def) def=`DEFAULT ${def}`;
		if(column.generated==="STORED") def = `${column.expression} STORED`;
		let notNull = column.isNullable?"NULL":"NOT NULL";
		if(column.generated==="STORED") {
            def = ` AS (${column.expression}) STORED`;
            notNull=""
        }
        definition.push(`${name}\t${column.sqltype}\t${column.isAutoNumber && column.isPrimaryKey ?" auto_increment":""}${def}\t${notNull}${column.isPrimaryKey && !column.isCompoundKey?" PRIMARY KEY":""}${extra}`);

        if(foreign[tableName+"_"+name]!==undefined) {
            column.references.push(foreign[tableName+"_"+name]);
            if(hasParent.indexOf(tableName)<0) {
                hasParent.push(tableName);
            }
        }

        column = Object.fromEntries(Object.entries(column).filter(([_, v]) => v != null));
        table.push(column);
    }

    Object.keys(wrappers).forEach((name)=>{
        let wrapper = wrappers[name];
        let definition = spaceTabs(wrapper.definition).join('\n  ,');
		let partition = wrapper.partition!==undefined?'\n'+wrapper.partition:'';
        definition = `CREATE TABLE IF NOT EXISTS ${name}\n(\n   ${definition}\n)${partition};`;

        let definitions = [];
        definitions.push(definition);

        let indexes = queryIndexes.filter((idx)=>idx['TABLE_NAME']===name);
        indexes.forEach((idx)=>{
            let isConstraint = idx['IS_UNIQUE']==='YES' || idx['IS_PRIMARY']==='YES' || idx['IS_FK']==='YES';

            if(isConstraint) {
			//console.log('HERE',idx)
			if(idx['IS_PRIMARY']==='YES') {
                    if(idx['FIELD_NAME'].indexOf(',')>0) {
                        definitions.push(`
alter table ${idx['TABLE_NAME']}
    add primary key (${idx['FIELD_NAME']});
`)
                    }
            } else if(idx['IS_UNIQUE']==='YES' && idx['IS_FK']==='NO') {
                    definitions.push(`
alter table ${idx['TABLE_NAME']}
    add constraint ${idx['INDEX_NAME']}
    unique (${idx['FIELD_NAME']});
`)
                    if(idx['IS_AUTONUMBER']==='YES') {
                        definitions.push(`
alter table ${idx['TABLE_NAME']}
    modify ${idx['FIELD_NAME']} ${idx['FIELD_TYPE']} auto_increment;`);
definitions.push(`
alter table ${idx['TABLE_NAME']}
    auto_increment = 1;`);
                    }
            } else if(idx['IS_FK']==='YES') {
				let refTable;
				let refCols;
				for (let i = 0; i < queryFkey.length; i++) {
					if(queryFkey[i].ID===schemaName+'/'+idx['INDEX_NAME']) {
						refTable=queryFkey[i].REF_NAME.replace(/.*\//g,'');
						refCols=queryFkey[i].REF_COL_NAME;
					}
				}

				definitions.push(`
alter table ${idx['TABLE_NAME']}
	add constraint ${idx['INDEX_NAME']}
	foreign key (${idx['FIELD_NAME']}) references ${refTable} (${refCols});
`);
			}
        } else {
			definitions.push(`
create index ${idx['INDEX_NAME']}
	on ${idx['TABLE_NAME']} (${idx['FIELD_NAME']});`)
		}
	});

        wrapper.definition = definitions.join('\n');
    });

    let tableOrder = [];
    for (let i = 0; i < tables.length; i++) {
        if(hasParent.indexOf(tables[i].name)<0) {
            tableOrder.push(tables[i].name);
        }
    }
    tableOrder.sort();
	let minpos = tableOrder.length;

    hasParent.forEach((child)=>{
        let tableColumns = schema[child];
        let pos=minpos;
        tableColumns.forEach((column)=>{
            column.references.forEach((reference)=>{
                let pos2 = tableOrder.indexOf(reference.tableName);
                if(pos2<0) { tableOrder.push(reference.tableName); pos=tableOrder.length }
                else if(pos2+1>pos) pos=pos2+1;
            });
        });
        if(tableOrder.indexOf(child)<0) {
            if(pos<0) tableOrder.push(child);
            else {
				tableOrder.splice(pos,0,child);
			}
        }
    });

    const procedures = [];
    for(let i=0;i<queryProcedures.length;i++) {
        const row = JSON.parse(JSON.stringify(queryProcedures[i]));
        const name = row["SPECIFIC_NAME"];
        let definition = row["ROUTINE_DEFINITION"];
        const params = [];
        let paramsDefinition = [];

        for(let j=0;j<queryParameters.length;j++){
            let paramISV = queryParameters[j];
            if(paramISV["SPECIFIC_NAME"]!==name) continue;
            let param =  {
                name: paramISV["PARAMETER_NAME"],
                ordinalPosition: paramISV["ORDINAL_POSITION"],
                sqltype: paramISV['DTD_IDENTIFIER'],
                maxLength: paramISV['CHARACTER_MAXIMUM_LENGTH'],
                type: paramISV['DATA_TYPE'],
                mode: paramISV['PARAMETER_MODE']
            }

            paramsDefinition.push(`${param.mode} ${param.name} ${param.sqltype}`);

            if(options.procedureISV) {
                param.informationSchemaValue=paramISV;
            }

            params.push(param);
        }

        paramsDefinition = paramsDefinition.join('\n\t,').trim();
		if(paramsDefinition) paramsDefinition=`\n\t ${paramsDefinition}\n`;

		definition = `
DELIMITER //
DROP PROCEDURE IF EXISTS ${name};
CREATE PROCEDURE ${name}(${paramsDefinition})
${definition};
//
DELIMITER ;
`;

        let routine = {
            name,
            schemaName: schemaName,
            kind: "procedure",
            definition,
            params
        };

        if(options.procedureISV) {
            routine.informationSchemaValue=row;
        }
        procedures.push(routine);
    }

    let result = {};
    result[schemaName] = {
        name: schemaName,
        tables,
        tableOrder,
        views,
        procedures
    }
    return result;
}

module.exports = {
    extractSchemas
};
