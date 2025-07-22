import mysql from 'mysql2'
import * as dbDetails from './details.mjs';
import winston from 'winston'
import * as secret from './logincreds.mjs';


const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
  winston.format.timestamp(),
  winston.format.printf(({ level, message, timestamp }) => {
  return `[${timestamp}] ${level}: ${message}`;
  })),
  transports: [
    //new winston.transports.Console()
    new winston.transports.File({ filename: 'databaseLogs.log' })
  ]
});

let databaseConnection = mysql.createConnection({
  host: secret.SQL_HOST,
  user: secret.SQL_USER,
  password: secret.SQL_PASSWORD
});

function connectDatabase(){
  return new Promise((resolve, reject) => {
    databaseConnection.connect(function(err){
    if (err) return reject(err);
    logger.info("Connected!");
    resolve();
  });
  })
}

function checkDatabaseAndCreate(con, databaseName){
  return new Promise((resolve, reject) => {
      con.query(`SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?`, [databaseName], (err, result) => {
      if (err){
        logger.info('failed to check for database');
        return reject(err);
      }
      if (result.length > 0) {
        logger.info(`Database ${databaseName} exists.`);
        resolve();
      } else {
        logger.info(`Database ${databaseName} does not exist.`);
        con.query(`CREATE DATABASE ${mysql.escapeId(databaseName)}`, function (err) {
          if (err) return reject(err);
          logger.info(`Database ${databaseName} created`);
          resolve();
        });
      }
    })
  })
}

function useDatabase(con, databaseName) {
  const useQuery = `USE ${mysql.escapeId(databaseName)}`;
  return new Promise((resolve, reject) =>{
  con.query(useQuery, (err) => {
  if (err) {
    logger.info('failed to use database');
    return reject(err);
  }
  logger.info(`Switched to database "${databaseName}"`);
  resolve();
  });
  });
}


export function checkTableAndCreate(con, databaseName, tableName, tableDetails){
  return new Promise((resolve, reject) =>{
    con.query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?", [databaseName, tableName], (err, result) =>{
      if (err){
        logger.info('failed to check table for table');
        return reject(err);
      }
      if(result.length > 0){
        logger.info(`table ${tableName} exists`);
        resolve();
      }
      else{
        con.query(`CREATE TABLE ${mysql.escapeId(tableName)} (${tableDetails})`, (err) => {
          if(err){
            logger.info('failed to create table in database');
            return reject(err);
          }
          logger.info(`table ${tableName} created`);
          resolve();
        })
      }
    });
  });
}

export function insertDataIntoDatabase(con, tableName, dataSet, userData){
  if(dataSet.length !== userData.length)
    return Promise.reject(new Error("Columns count doesn't match values count"));
  
  const placeHolders = userData.map(()=>'?').join(', ');
  const columnNames = dataSet.map(col => mysql.escapeId(col)).join(', ');
  const statement = `INSERT INTO ${mysql.escapeId(tableName)} (${columnNames}) VALUES(${placeHolders})`;

  return new Promise((resolve, reject) => {
    con.query(statement, userData, (err, result) =>{
      if(err){
        if(err.errno === 1062){
          logger.info('duplicate');
          return resolve({status:'DUPLICATE'});
        }
        else{
          logger.info(`failed to insert data in to data base ${tableName}, ${dataSet}`);
          return reject(err);
        }
      }
      resolve({status:'SUCCESS', result});
    });
  });
}

export function readFromDatabase(con, tableName, dataSet, constraintParameter, constraintValue){
  let parameters = '';
  let values = [];
  if(Array.isArray(constraintParameter)){
    if(!Array.isArray(constraintValue) || (constraintParameter.length !== constraintValue.length)){
      logger.info('Constraint parameters and values must be the same length', constraintParameter.length, constraintValue.length);
      throw new Error('Constraint parameters and values must be the same length');
    }
    parameters = constraintParameter.map(para => `${mysql.escapeId(para)} = ?`).join(' AND ');
    values = constraintValue;
  }
  else{
    parameters = `${mysql.escapeId(constraintParameter)} = ?`;
    values = [constraintValue];
  }
  const statement = `SELECT ${Array.isArray(dataSet) ? dataSet.map(col => mysql.escapeId(col)).join(', ') : mysql.escapeId(dataSet) } From ${mysql.escapeId(tableName)} where ${parameters};`;
  return new Promise((resolve, reject) => {
    con.query(statement, values, (err, result) => {
      if(err){
        logger.info('failed to select data');
        return reject(err);
      }
      resolve(result);
    })
  });
}

async function setupDataBase(){
  await connectDatabase();
  await checkDatabaseAndCreate(databaseConnection, secret.SQL_DB_NAME);
  await useDatabase(databaseConnection, secret.SQL_DB_NAME);
  await checkTableAndCreate(databaseConnection, secret.SQL_DB_NAME, dbDetails.DB_USERS_TABLE, dbDetails.USERS_TABLE_SCHEMA);
  await checkTableAndCreate(databaseConnection, secret.SQL_DB_NAME, dbDetails.DB_TABLE_ONE, dbDetails.TABLE_ONE_SCHEMA);
  await checkTableAndCreate(databaseConnection, secret.SQL_DB_NAME, dbDetails.DB_TABLE_TWO, dbDetails.TABLE_TWO_SCHEMA);
  await checkTableAndCreate(databaseConnection, secret.SQL_DB_NAME, dbDetails.DB_TABLE_THREE, dbDetails.TABLE_THREE_SCHEMA);

  // INSERT TESTS:
  // passed this test, successfully added 'testUsr' and 'testPass' into the database.
  // successfully failed to re-add the testUsr as it's supposed to be unique.
  
  //console.log(await insertDataIntoDatabase(databaseConnection, dbDetails.DB_USERS_TABLE, dbDetails.USERS_INSERT_COULMNS, ["testUsr", "testPass"]));
  //await insertDataIntoDatabase(databaseConnection, dbDetails.DB_USERS_TABLE, dbDetails.USERS_INSERT_COULMNS, ["testUsr", "testPass", "hello"]);
  
  
  // SELECT TESTS:
  // successfully read data when * was used, when columns were specified, when arrays were given,
  // and failed appropriately when expected (wrong fields etc...)
  
  // console.log(await readFromDatabase(databaseConnection, dbDetails.DB_USERS_TABLE, '*', 'username', 'testUsr'));
  // console.log(await readFromDatabase(databaseConnection, dbDetails.DB_USERS_TABLE, dbDetails.USERS_INSERT_COULMNS, 'username', 'testUsr'));
  // console.log(await readFromDatabase(databaseConnection, dbDetails.DB_USERS_TABLE, dbDetails.USERS_INSERT_COULMNS, ['username'], ['testUsr']));
  // console.log(await readFromDatabase(databaseConnection, dbDetails.DB_USERS_TABLE, dbDetails.USERS_INSERT_COULMNS, ['username', 'password'], ['testUsr', 'testPass']));
  // console.log(await readFromDatabase(databaseConnection, dbDetails.DB_USERS_TABLE, dbDetails.USERS_INSERT_COULMNS, ['username'], ['non-existing-user']));
  // console.log(await readFromDatabase(databaseConnection, dbDetails.DB_USERS_TABLE, dbDetails.USERS_INSERT_COULMNS, ['username', 'password'], ['testUsr', 'non-existing-password']));
  // console.log(await readFromDatabase(databaseConnection, dbDetails.DB_TABLE_ONE, dbDetails.USERS_INSERT_COULMNS, ['username', 'password'], ['testUsr', 'non-existing-password']));
  // console.log(await readFromDatabase(databaseConnection, dbDetails.DB_USERS_TABLE, dbDetails.TABLE_ONE_INSERT_COLUMNS, ['username', 'password'], ['testUsr', 'non-existing-password']));
}


setupDataBase();


// create Insert and read function for my database --> DONE!
// then create http server to indirectly access the database (backend) --> next
// then start working on the front end (simple ui just to create accounts sign in and add data into my sql database)
