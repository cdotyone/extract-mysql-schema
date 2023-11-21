"use strict";
const SequelizeAdapter = require("sequelize");
const orderBy = require("lodash.orderby");

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

const extractSchemas = async function (connection) {
    const schemaName = connection.database;

    let adapter = await getAdapter(connection);

    let fkeys = await adapter.query(`
    SELECT iif.*, iifc.FOR_COL_NAME, iifc.REF_COL_NAME
    FROM INFORMATION_SCHEMA.INNODB_FOREIGN as iif
    JOIN INFORMATION_SCHEMA.INNODB_FOREIGN_COLS as iifc on iifc.ID=iif.ID
    `);
    fkeys=fkeys[0];

    let columns = await adapter.query(`
    SELECT *
    FROM  INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = '${schemaName}'
    `);
    await adapter.close();

    columns = columns[0];

    const foreign = {};
    for(let i=0;i<fkeys.length;i++) {
        const tableName = fkeys[i]['FOR_NAME'].substring(schemaName.length+1);
        const keyName = fkeys[i]['ID'].substring(schemaName.length+1);
        foreign[tableName+"_"+fkeys[i]['FOR_COL_NAME']] = {
            "schemaName": schemaName,
            "tableName": fkeys[i]['REF_NAME'].substring(schemaName.length+1),
            "columnName": fkeys[i]['FOR_COL_NAME'],
            "onUpdate": "CASCADE",
            "onDelete": "RESTRICT",
            "name": keyName
          };
    }

    let schema = {};
    let tables = [];
    let hasParent = [];
    for (let i = 0; i < columns.length; i++) {
        let name = columns[i]['COLUMN_NAME'];

        let tableName = columns[i]['TABLE_NAME'];
        let table = [];
        if (schema[tableName]) table = schema[tableName];
        else {
            schema[tableName] = table;
            tables.push({
                name: tableName,
                schemaName: schemaName,
                kind: "table",
                columns: table,
                informationSchemaValue: {
                    is_insertable_into: 'YES',
                    table_type: 'BASE',
                    table_catalog: schemaName,
                    table_name: tableName,
                    table_schema: schemaName
                }
            });
        }

        let column = {
            name: name,
            ordinalPosition: columns[i]['ORDINAL_POSITION'],
            sqltype: columns[i]['COLUMN_TYPE'],
            maxLength: columns[i]['CHARACTER_MAXIMUM_LENGTH'],
            isPrimaryKey: columns[i]['COLUMN_KEY'] === 'PRI',
            isNullable: columns[i]['IS_NULLABLE'] === 'YES',
            generated: columns[i]['EXTRA'].indexOf('DEFAULT_GENERATED') >= 0 ? (columns[i]['EXTRA'].indexOf('on update') > 0 ? "ALWAYS" : "BY DEFAULT") : "NEVER",
            isUpdatable: columns[i]['EXTRA'].indexOf('DEFAULT_GENERATED') < 0,
            type: columns[i]['DATA_TYPE'],
            defaultValue: columns[i]['COLUMN_DEFAULT'] || "",
            references:[]
        };

        if(foreign[tableName+"_"+name]!==undefined) {
            column.references.push(foreign[tableName+"_"+name]);
            if(hasParent.indexOf(tableName)<0) {
                hasParent.push(tableName);
            }
        }

        column = Object.fromEntries(Object.entries(column).filter(([_, v]) => v != null));
        table.push(column);
    }

    let noparent = [];
    for (let i = 0; i < tables.length; i++) {
        if(hasParent.indexOf(tables[i].name)<0) {
            noparent.push(tables[i].name);
        }
    }
    noparent.sort();

    let byCounts = {};
    for (let i = 0; i < hasParent.length; i++) {
        let tableName = hasParent[i];
        let table = schema[hasParent[i]];
        for (let j = 0; j < table.length; j++) {
            var column = table[j];
            var references = column.references;
            if(column.references.length==0) continue;

            for (let k = 0; k < references.length; k++) {
                var reference = references[k];
                if(byCounts[reference.tableName]===undefined) byCounts[reference.tableName]={name:reference.tableName,count:0,children:[]};
                byCounts[reference.tableName].count++;
                byCounts[reference.tableName].children.push(tableName);
            }
        }
    }
    byCounts = orderBy(byCounts,['count']).reverse();
    let tableOrder = noparent;
    for(let i=0;i<byCounts.length;i++){
        if(tableOrder.indexOf(byCounts[i].name)<0)
            tableOrder.push(byCounts[i].name);

        let children = byCounts[i].children;
        for(let j=0;j<children.length;j++){
            let child=children[j];
            if(tableOrder.indexOf(child)<0 && byCounts.indexOf(child)<0) {
                tableOrder.push(child);
            }
        }
    }

    let result = {};
    result[schemaName] = {
        name: schemaName,
        tables: tables,
        tableOrder,
        views: []
    }
    return result;
}

module.exports = {
    extractSchemas
};