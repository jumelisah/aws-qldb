/*
 * Lambda function that implements the get licence functionality
 */
const { Logger, injectLambdaContext } = require('@aws-lambda-powertools/logger');
const { Tracer, captureLambdaHandler } = require('@aws-lambda-powertools/tracer');
const { Metrics, logMetrics } = require('@aws-lambda-powertools/metrics');
const middy = require('@middy/core');
const { getLicence, getAllStudent } = require('./helper/licence');
const LicenceNotFoundError = require('./lib/LicenceNotFoundError');

//  Params fetched from the env vars
const logger = new Logger();
const tracer = new Tracer();
const metrics = new Metrics();

tracer.captureAWS(require('aws-sdk'));

const handler = async (event) => {
  const { studentId } = event.pathParameters;
  logger.debug(`In the get-licence handler with studentId ${studentId}`);

  try {
    const response = await getAllStudent;
    const licence = JSON.parse(response);

    return {
      statusCode: 200,
      body: JSON.stringify(licence),
    };
  } catch (error) {
    if (error instanceof LicenceNotFoundError) {
      return error.getHttpResponse();
    }
    logger.error(`Error returned: ${error}`);
    const errorBody = {
      status: 500,
      title: error.name,
      detail: error.message,
    };
    return {
      statusCode: 500,
      body: JSON.stringify(errorBody),
    };
  }
};

module.exports.handler = middy(handler)
  .use(injectLambdaContext(logger))
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }));
