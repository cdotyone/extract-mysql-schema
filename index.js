"use strict";
const SequelizeAdapter = require("sequelize");

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

const lowerize = obj =>
  Object.keys(obj).reduce((acc, k) => {
    acc[k.toLowerCase()] = obj[k];
    return acc;
  }, {});

const extractSchemas = async function (connection,options) {
    const schemaName = connection.database;
    options = options || {columnISV:false,tableISV:true};

    let adapter = await getAdapter(connection);

    let tableISV={};
    if(options.tableISV) {
        let queryTableISV = await adapter.query(`
        SELECT *
        FROM  INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = '${schemaName}'
        `);
        queryTableISV = queryTableISV[0];
        for(let i=0;i<queryTableISV.length;i++){
            tableISV[queryTableISV[i]["TABLE_NAME"]]=lowerize(queryTableISV[i]);
        }
    }

    let fkeys = await adapter.query(`
    SELECT iif.*, iifc.FOR_COL_NAME, iifc.REF_COL_NAME
    FROM INFORMATION_SCHEMA.INNODB_FOREIGN as iif
    JOIN INFORMATION_SCHEMA.INNODB_FOREIGN_COLS as iifc on iifc.ID=iif.ID
    WHERE iif.ID like '${schemaName}/%'
    `);
    fkeys=fkeys[0];

    let columns = await adapter.query(`
    SELECT *
    FROM  INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = '${schemaName}'
    ORDER BY TABLE_NAME,ORDINAL_POSITION
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
    for (let i = 0; i < columns.length; i++) {
        let name = columns[i]['COLUMN_NAME'];

        let tableName = columns[i]['TABLE_NAME'];
        let table = [];
        if (schema[tableName]) table = schema[tableName];
        else {
            schema[tableName] = table;
            let wrapper = {
                name: tableName,
                schemaName: schemaName,
                kind: "table",
                columns: table
            };
            if(options.tableISV) {
                let isv = tableISV[tableName];
                if(isv.table_type==='BASE TABLE') isv.table_type="BASE";
                isv.is_insertable_into=isv.is_insertable_into||'YES';
                wrapper.informationSchemaValue=isv;
            }
            tables.push(wrapper);
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

        if(options.columnISV) {
            column.informationSchemaValue = lowerize(columns[i]);
        }
        if(foreign[tableName+"_"+name]!==undefined) {
            column.references.push(foreign[tableName+"_"+name]);
        }

        column = Object.fromEntries(Object.entries(column).filter(([_, v]) => v != null));
        table.push(column);
    }

    let result = {};
    result[schemaName] = {
        name: schemaName,
        tables: tables,
        views: []
    }
    return result;
}

module.exports = {
    extractSchemas
};