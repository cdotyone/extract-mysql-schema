"use strict";
const mysql = require('mysql2/promise');

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

const extractSchemas = async function (connection, options) {
    const schemaName = connection.database;
    options = options || {};


    let c = await mysql.createConnection(connection);

    let queryProcedures = [];
    let queryParameters = [];
    let queryColumns = [];
    let queryFkey = [];
    let queryIndexes = [];
    let [tablenames] = await c.query('SHOW TABLES');
    let [proceduresResult] = await c.query(`SHOW PROCEDURE STATUS`);

    const tableKey = Object.keys(tablenames[0])[0];

    for (const row of tablenames) {
        const tableName = row[tableKey];
        const [columnsResult] = await c.query( `SHOW COLUMNS FROM \`${tableName}\`` );
        const [indexResult] = await c.query( `SHOW INDEX FROM \`${tableName}\`` );
        const [keysResult] = await c.query( `SHOW KEYS FROM \`${tableName}\`` );


        for(let col in columnsResult) {
            let column = {
                "TABLE_TYPE": "BASE TABLE",
                "TABLE_CATALOG": "def",
                "TABLE_SCHEMA": schemaName,
                "TABLE_NAME": tableName,
                "COLUMN_NAME": columnsResult[col]['Field'],
                "ORDINAL_POSITION": col,
                "COLUMN_KEY": columnsResult[col]['Key'],
                "EXTRA": columnsResult[col]['Extra'],
                "IS_NULLABLE": columnsResult[col]['Null']==='YES' ? 'YES' : 'NO',
                "COLUMN_DEFAULT": columnsResult[col]['Default'],
                "COLUMN_TYPE": columnsResult[col]['Type'],
                "DATA_TYPE": columnsResult[col]['Type'].split('(')[0],
                "GENERATION_EXPRESSION": columnsResult[col]['Extra'].indexOf('GENERATED')>=0 ? columnsResult[col]['Default'] || '' : '',
                "CHARACTER_MAXIMUM_LENGTH": columnsResult[col]['Type'].split('(')[1] ? parseInt(columnsResult[col]['Type'].split('(')[1]) : 0,
            };

            for(let idx in indexResult) {
                if(indexResult[idx]['Column_name']===column['COLUMN_NAME']) {
                    column['IS_COMPOUND_KEY'] = indexResult[idx]['Key_name'] !== 'PRIMARY' && indexResult[idx]['Seq_in_index'] > 1 ? 'YES' : 'NO';
                    column["IS_PRIMARY_KEY"] = indexResult[idx]['Key_name'] === 'PRIMARY' ? 'YES' : 'NO';
                }
            }
            queryColumns.push(column)
        }

        for(let key in keysResult) {
            if(keysResult[key]['Key_name']!=='PRIMARY' && keysResult[key]['Referenced_table_name']) {
                let fkey = {
                    "ID": schemaName + '/' + keysResult[key]['Key_name'],
                    "FOR_NAME": schemaName + '/' + tableName,
                    "FOR_COL_NAME": keysResult[key]['Column_name'],
                    "REF_NAME": schemaName + '/' + keysResult[key]['Referenced_table_name'],
                    "REF_COL_NAME": keysResult[key]['Referenced_column_name']
                };
                queryFkey.push(fkey);
            }
        }

        queryIndexes=[]
        for(let idx in indexResult) {
            let isUnique = indexResult[idx]['Non_unique'] === 0 ? 'YES' : 'NO';
            let isPrimary = indexResult[idx]['Key_name'] === 'PRIMARY' ? 'YES' : 'NO';
            let isFK = 'NO';
            for(let key in keysResult) {
                if(keysResult[key]['Key_name']===indexResult[idx]['Key_name'] && keysResult[key]['Referenced_table_name']) {
                    isFK = 'YES';
                }
            }
            queryIndexes.push({
                "TABLE_SCHEMA": schemaName,
                "TABLE_NAME": tableName,
                "INDEX_NAME": indexResult[idx]['Key_name'],
                "FIELD_TYPE": indexResult[idx]['Index_type'],
                "POS": indexResult[idx]['Seq_in_index'] - 1,
                "TYPE": indexResult[idx]['Index_type'],
                "IS_UNIQUE": isUnique,
                "IS_PRIMARY": isPrimary,
                "IS_FK": isFK,
                "IS_AUTONUMBER": 'NO',
                "FIELD_NAME": indexResult[idx]['Column_name']
            });
        }
    }

    for(let proc of proceduresResult) {
        if(proc['Db']!==schemaName) continue;
        const [procDefResult] = await c.query( `SHOW CREATE PROCEDURE \`${proc['Name']}\`` );
        let procedure = {
            "SPECIFIC_NAME": proc['Name'],
            "ROUTINE_DEFINITION": procDefResult[0]['Create Procedure']
        };
        queryProcedures.push(procedure);

        const match = procDefResult[0]['Create Procedure'].match(/\(([\s\S]*?)\)/);
        if (!match) { console.log('No parameters found'); return []; }
        const paramString = match[1].trim();
        const params = paramString .split(',') .map(p => p.trim()) .filter(p => p.length > 0);

        for (let i = 0; i < params.length; i++) {
            const paramParts = params[i].split(/\s+/);
            let paramMode = 'IN';
            let paramName, paramType;
            if (paramParts.length === 2) {
                paramName = paramParts[0];
                paramType = paramParts[1];
            } else if (paramParts.length === 3) {
                paramMode = paramParts[0];
                paramName = paramParts[1];
                paramType = paramParts[2];
            }
            let parameter = {
                "SPECIFIC_NAME": proc['Name'],
                "PARAMETER_NAME": paramName,
                "ORDINAL_POSITION": i + 1,
                "PARAMETER_MODE": paramMode,
                "DATA_TYPE": paramType.split('(')[0],
                "DTD_IDENTIFIER": paramType,
                "CHARACTER_MAXIMUM_LENGTH": paramType.split('(')[1] ? parseInt(paramType.split('(')[1]) : 0,
            };
            queryParameters.push(parameter);
        }
    }

    c.end();

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
		if(wrapper.partition!==undefined && queryColumns[i]['PARTITION_METHOD']!==null) wrapper.partition=`PARTITION BY ${queryColumns[i]['PARTITION_METHOD']}(${queryColumns[i]['PARTITION_EXPRESSION']})`;
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

DROP PROCEDURE IF EXISTS ${name};
DELIMITER //
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
