/*
 * Helper utility that provides the implementation for interacting with QLDB
 */

// const AWSXRay = require('aws-xray-sdk-core');
// AWSXRay.captureAWS(require('aws-sdk'));

const { getQldbDriver } = require('./ConnectToLedger');
const LicenceIntegrityError = require('../lib/LicenceIntegrityError');
const LicenceNotFoundError = require('../lib/LicenceNotFoundError');

/**
 * Check if an email address already exists
 * @param txn The {@linkcode TransactionExecutor} for lambda execute.
 * @param email The email address of the licence holder.
 * @param logger The logger object
 * @returns The number of records that exist for the email address
 */
async function checkEmailUnique(txn, email, logger) {
  logger.debug('In checkEmailUnique function');
  const query = 'SELECT email FROM Student AS b WHERE b.email = ?';
  let recordsReturned;
  await txn.execute(query, email).then((result) => {
    recordsReturned = result.getResultList().length;
    if (recordsReturned === 0) {
      logger.debug(`No records found for ${email}`);
    } else {
      logger.info(`Record already exists for ${email}`);
    }
  });
  return recordsReturned;
}

/**
 * Insert the new Licence document to the Student table
 * @param txn The {@linkcode TransactionExecutor} for lambda execute.
 * @param licenceDoc The document containing the details to insert.
 * @param logger The logger object
 * @returns The Result from executing the statement
 */
async function createStudent(txn, licenceDoc, logger) {
  logger.debug('In the createStudent function');
  const statement = 'INSERT INTO Student ?';
  return txn.execute(statement, licenceDoc);
}

/**
 * Insert the new Licence document to the Student table
 * @param txn The {@linkcode TransactionExecutor} for lambda execute.
 * @param id The document id of the document.
 * @param studentId The studentId to add to the document
 * @param email The email address of the licence holder.
 * @param logger The logger object
 * @returns The Result from executing the statement
 */
async function addGuid(txn, id, studentId, email, logger) {
  logger.debug('In the addGuid function');
  const statement = 'UPDATE Student as b SET b.guid = ?, b.studentId = ? WHERE b.email = ?';
  return txn.execute(statement, id, studentId, email);
}

/**
 * Creates a new licence record in the QLDB ledger.
 * @param name The name of the licence holder.
 * @param email The email address of the licence holder.
 * @param telephone The telephone number of the licence holder.
 * @param address The address of the licence holder.
 * @param event The LicenceHolderCreated event record to add to the document.
 * @param logger The logger object
 * @returns The JSON record of the new licence reecord.
 */
const createLicence = async (firstName, lastName, email, telephone, address, event, logger) => {
  logger.debug(`In createLicence function with: first name ${firstName} last name ${lastName} email ${email} telephone ${telephone} and address ${address}`);

  let licence;
  // Get a QLDB Driver instance
  const qldbDriver = await getQldbDriver();
  await qldbDriver.executeLambda(async (txn) => {
    // Check if the record already exists assuming email unique for demo
    const recordsReturned = await checkEmailUnique(txn, email, logger);
    if (recordsReturned === 0) {
      const licenceDoc = [{
        firstName, lastName, email, telephone, address, penaltyPoints: 0, events: event,
      }];
      // Create the record. This returns the unique document ID in an array as the result set
      const result = await createStudent(txn, licenceDoc, logger);
      const docIdArray = result.getResultList();
      const docId = docIdArray[0].get('documentId').stringValue();
      // Update the record to add the document ID as the GUID in the payload
      await addGuid(txn, docId, docId.toUpperCase(), email, logger);
      licence = {
        guid: docId,
        studentId: docId.toUpperCase(),
        firstName,
        lastName,
        penaltyPoints: 0,
        email,
        telephone,
        address,
      };
    } else {
      throw new LicenceIntegrityError(400, 'Licence Integrity Error', `Licence record with email ${email} already exists. No new record created`);
    }
  }, () => logger.info('Retrying due to OCC conflict...'));
  return licence;
};

/**
 * Helper function to get the latest revision of document by email address
 * @param txn The {@linkcode TransactionExecutor} for lambda execute.
 * @param email The email address of the document to retrieve
 * @param logger The logger object
 * @returns The Result from executing the statement
 */
async function getLicenceRecordByEmail(txn, email, logger) {
  logger.debug('In getLicenceRecordByEmail function');
  const query = 'SELECT * FROM Student AS b WHERE b.email = ?';
  return txn.execute(query, email);
}

const getAllData = async(txn, logger)=>{
  logger.debug('In getLicenceRecordByEmail function');
  return txn.execute('SELECT * FROM Student AS b')
}
/**
 * Helper function to get the latest revision of document by document Id
 * @param txn The {@linkcode TransactionExecutor} for lambda execute.
 * @param id The document id of the document to retrieve
 * @param logger The logger object
 * @returns The Result from executing the statement
 */
async function getLicenceRecordById(txn, id, logger) {
  logger.debug('In getLicenceRecordById function');
  const query = 'SELECT * FROM Student AS b WHERE b.studentId = ?';
  return txn.execute(query, id);
}

/**
 * Helper function to update the document with penalty points and event details
 * @param txn The {@linkcode TransactionExecutor} for lambda execute.
 * @param points The latest points total to update
 * @param event The event to add to the document
 * @param email The email address of the document to update
 * @param logger The logger object
 * @returns The Result from executing the statement
 */
async function addEvent(txn, points, event, email, logger) {
  logger.debug('In the addEvent function');
  const statement = 'UPDATE Student as b SET b.penaltyPoints = ?, b.events = ? WHERE b.email = ?';
  return txn.execute(statement, points, event, email);
}

/**
 * Helper function to update the document with new contact details
 * @param txn The {@linkcode TransactionExecutor} for lambda execute.
 * @param telephone The latest telephone number to update
 * @param address The latest address to update
 * @param event The event to add to the document
 * @param email The email address of the document to update
 * @param logger The logger object
 * @returns The Result from executing the statement
 */
async function addContactUpdatedEvent(txn, telephone, address, event, email, logger) {
  logger.debug(`In the addContactUpdatedEvent function with telephone ${telephone} and address ${address}`);
  const statement = 'UPDATE Student as b SET b.telephone = ?, b.address = ?, b.events = ? WHERE b.email = ?';
  return txn.execute(statement, telephone, address, event, email);
}

/**
 * Update the Licence document with an PointsAdded or PointsRemoved event
 * @param email The email address of the document to update
 * @param event The event to add
 * @param logger The logger object
 * @returns A JSON document to return to the client
 */
const getAllStudent = async(logger) => {
  logger.debug('Get all student data');
  let student = {greet: "halo"};
  const qldbDriver = await getQldbDriver();
  await qldbDriver.executeLambda(async (txn) => {
    const id ="6LtwKJ9Y8ks2bY3bEhUayZ";
    student = JSON.stringify(txn.execute('SELECT * FROM Student AS b WHERE b.studentId=?', id));

    // if (student.length === 0) {
    //   throw new LicenceNotFoundError(400, 'Licence Not Found Error', `Student record does not exist`);
    // }
  }, () => logger.info('Retrying due to OCC conflict...'));
  return student;
}
const updateStudentData = async(data, logger) => {
  logger.debug(`In updateStudentData function with studentId ${data.studentId}`);
  let licence;
  // Get a QLDB Driver instance
  const qldbDriver = await getQldbDriver();
  await qldbDriver.executeLambda(async (txn) => {
    // Get the current record

    const result = await getLicenceRecordById(txn, data.studentId, logger);
    const resultList = result.getResultList();

    if (resultList.length === 0) {
      throw new LicenceIntegrityError(400, 'Student Integrity Error', `Student record with studentId ${data.studentId} does not exist`);
    } else {
      const oldData = resultList[0];
      for(let x in oldData["_fields"]){
        if(!data[x]){
          data[x] = oldData["_fields"][x];
        }
      };
      const statement = 'UPDATE Student AS b SET b = ? WHERE b.studentId = ?';
      licence = txn.execute(statement, data, data.studentId);
    }
  }, () => logger.info('Retrying due to OCC conflict...'));
  return licence;
}

const updateLicence = async (email, eventInfo, logger) => {
  logger.debug(`In updateLicence function with email ${email} and eventInfo ${eventInfo}`);

  let licence;
  // Get a QLDB Driver instance
  const qldbDriver = await getQldbDriver();
  await qldbDriver.executeLambda(async (txn) => {
    // Get the current record

    const result = await getLicenceRecordByEmail(txn, email, logger);
    const resultList = result.getResultList();

    if (resultList.length === 0) {
      throw new LicenceIntegrityError(400, 'Licence Integrity Error', `Licence record with email ${email} does not exist`);
    } else {
      const originalLicence = JSON.stringify(resultList[0]);
      const newLicence = JSON.parse(originalLicence);
      const originalPoints = newLicence.penaltyPoints;

      const updatedPoints = eventInfo.penaltyPoints;

      let newPoints = null;
      if (eventInfo.eventName === 'PenaltyPointsAdded') {
        newPoints = originalPoints + updatedPoints;
      } else {
        newPoints = originalPoints - updatedPoints;
      }

      const { events } = newLicence;
      events.unshift(eventInfo);
      await addEvent(txn, newPoints, events, email, logger);
      licence = {
        email,
        updatedPenaltyPoints: newPoints,
      };
    }
  }, () => logger.info('Retrying due to OCC conflict...'));
  return licence;
};

/**
 * Update the Licence document with new contact details
 * @param telephone The updated telephone number
 * @param address The updated address
 * @param email The email address of the document to update
 * @param event The event to add
 * @param logger The logger object
 * @returns A JSON document to return to the client
 */
const updateContact = async (telephone, address, email, eventInfo, logger) => {
  logger.debug(`In updateContact function with telephone ${telephone} address ${address} email ${email} and eventInfo ${eventInfo}`);

  let licence;
  // Get a QLDB Driver instance
  const qldbDriver = await getQldbDriver();
  await qldbDriver.executeLambda(async (txn) => {
    // Get the current record

    const result = await getLicenceRecordByEmail(txn, email, logger);
    const resultList = result.getResultList();

    if (resultList.length === 0) {
      throw new LicenceIntegrityError(400, 'Licence Integrity Error', `Licence record with email ${email} does not exist`);
    } else {
      const originalLicence = JSON.stringify(resultList[0]);
      const newLicence = JSON.parse(originalLicence);
      const { events } = newLicence;
      events.unshift(eventInfo);

      let newTelephone = telephone;
      if (telephone === undefined) {
        newTelephone = newLicence.telephone;
      }

      let newaddress = address;
      if (address === undefined) {
        newaddress = newLicence.address;
      }

      await addContactUpdatedEvent(txn, newTelephone, newaddress, events, email, logger);
      licence = {
        email,
        response: 'Contact details updated',
      };
    }
  }, () => logger.info('Retrying due to OCC conflict...'));
  return licence;
};

/**
 * Helper function to delete the document
 * @param txn The {@linkcode TransactionExecutor} for lambda execute.
 * @param id The document id of the document to delete
 * @param logger The logger object
 * @returns The Result from executing the statement
 */
async function deleteLicenceRecordById(txn, id, logger) {
  logger.debug('In deleteLicenceRecordById function');
  const query = 'DELETE FROM Student AS b WHERE b.studentId = ?';
  return txn.execute(query, id);
}

/**
 * Helper function to retrieve the current state of a licence record
 * @param id The document id of the document to retrieve
 * @param logger The logger object
 * @returns The JSON document to return to the client
 */
const getLicence = async (id, logger) => {
  logger.debug(`In getLicence function with studentId ${id}`);

  let licence;
  // Get a QLDB Driver instance
  const qldbDriver = await getQldbDriver();
  await qldbDriver.executeLambda(async (txn) => {
    // Get the current record
    const result = await getLicenceRecordById(txn, id, logger);
    const resultList = result.getResultList();

    if (resultList.length === 0) {
      throw new LicenceNotFoundError(400, 'Licence Not Found Error', `Licence record with studentId ${id} does not exist`);
    } else {
      licence = JSON.stringify(resultList[0]);
    }
  }, () => logger.info('Retrying due to OCC conflict...'));
  return licence;
};

/**
 * Function to delete a licence record
 * @param id The document id of the document to delete
 * @param logger The logger object
 * @returns The JSON response to return to the client
 */
const deleteLicence = async (id, logger) => {
  logger.debug(`In deleteLicence function with studentId ${id}`);

  let licence;
  // Get a QLDB Driver instance
  const qldbDriver = await getQldbDriver();
  await qldbDriver.executeLambda(async (txn) => {
    // Get the current record
    const result = await getLicenceRecordById(txn, id, logger);
    const resultList = result.getResultList();

    if (resultList.length === 0) {
      throw new LicenceNotFoundError(400, 'Licence Not Found Error', `Licence record with studentId ${id} does not exist`);
    } else {
      await deleteLicenceRecordById(txn, id, logger);
      licence = '{"response": "Licence record deleted"}';
    }
  }, () => logger.info('Retrying due to OCC conflict...'));
  return licence;
};

module.exports = {
  createLicence,
  updateLicence,
  getLicence,
  updateContact,
  deleteLicence,
  updateStudentData,
  getAllStudent,
};
