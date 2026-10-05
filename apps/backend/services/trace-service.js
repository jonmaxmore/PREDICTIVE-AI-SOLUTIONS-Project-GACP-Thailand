const common = require('./trace-service/common');
const queries = require('./trace-service/queries');
const { resolveTraceByPlotCycleQr } = require('./trace-service/resolve-plot-cycle');
const { resolveTraceByGenericQr } = require('./trace-service/resolve-generic');

module.exports = {
    ...common,
    ...queries,
    resolveTraceByPlotCycleQr,
    resolveTraceByGenericQr,
};
