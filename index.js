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

const extractSchemas = async function (connection) {
    const schemaName = connection.database;

    let adapter = await getAdapter(connection);
    let columns = await adapter.query(`
    SELECT *
    FROM  INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = '${schemaName}'
    `);
    await adapter.close();

    columns = columns[0];

    let schema = {};
    let tables = [];
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
            defaultValue: columns[i]['COLUMN_DEFAULT'] || ""
        };

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
