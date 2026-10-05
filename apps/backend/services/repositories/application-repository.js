/**
 * Application Repository — data access for the Application model.
 *
 * Extends BaseRepository with application-specific query helpers.
 *
 * @module services/repositories/application-repository
 */

const BaseRepository = require('./base-repository');

class ApplicationRepository extends BaseRepository {
    constructor() {
        super('application', {
            softDelete: true,
            searchFields: ['applicationNumber', 'serviceType'],
        });
    }

    /** Find application by application number */
    async findByNumber(applicationNumber) {
        return this.findOne({ applicationNumber });
    }

    /** Get all applications for a specific applicant */
    async findByApplicant(applicantId, options = {}) {
        return this.findMany({ applicantId }, options);
    }

    /** Get applications by status */
    async findByStatus(status, options = {}) {
        return this.findMany({ status }, options);
    }

    /** Get applications by workflow state */
    async findByWorkflowState(workflowState, options = {}) {
        return this.findMany({ workflowState }, options);
    }

    /** Count applications by status for dashboard */
    async countByStatus() {
        const [total, draft, pending, approved, rejected] = await Promise.all([
            this.count({}),
            this.count({ status: 'DRAFT' }),
            this.count({ status: 'PENDING' }),
            this.count({ status: 'APPROVED' }),
            this.count({ status: 'REJECTED' }),
        ]);
        return { total, draft, pending, approved, rejected };
    }
}

module.exports = new ApplicationRepository();
