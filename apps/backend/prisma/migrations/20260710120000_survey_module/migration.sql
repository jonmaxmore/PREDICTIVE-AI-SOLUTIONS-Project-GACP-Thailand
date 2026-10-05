-- CreateTable
CREATE TABLE "survey_templates" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "targetGroup" TEXT NOT NULL DEFAULT 'FARMER',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "activatedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "survey_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_questions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "templateId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "section" TEXT,
    "questionText" TEXT NOT NULL,
    "questionType" TEXT NOT NULL DEFAULT 'TEXT',
    "choices" JSONB,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "survey_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_responses" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "templateId" TEXT NOT NULL,
    "respondentUserId" TEXT,
    "respondentType" TEXT NOT NULL DEFAULT 'FARMER',
    "region" TEXT NOT NULL,
    "province" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "survey_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_answers" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responseId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "valueText" TEXT,
    "valueNumber" DOUBLE PRECISION,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "survey_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expert_interviews" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "intervieweeName" TEXT NOT NULL,
    "intervieweeOrg" TEXT,
    "intervieweeRole" TEXT,
    "interviewDate" TIMESTAMP(3) NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'ONSITE',
    "transcript" TEXT NOT NULL,
    "keyInsights" JSONB,
    "recordedBy" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "expert_interviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "survey_templates_organizationId_idx" ON "survey_templates"("organizationId");

-- CreateIndex
CREATE INDEX "survey_templates_status_idx" ON "survey_templates"("status");

-- CreateIndex
CREATE INDEX "survey_templates_isDeleted_idx" ON "survey_templates"("isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "survey_templates_organizationId_code_key" ON "survey_templates"("organizationId", "code");

-- CreateIndex
CREATE INDEX "survey_questions_templateId_idx" ON "survey_questions"("templateId");

-- CreateIndex
CREATE INDEX "survey_questions_organizationId_idx" ON "survey_questions"("organizationId");

-- CreateIndex
CREATE INDEX "survey_responses_templateId_idx" ON "survey_responses"("templateId");

-- CreateIndex
CREATE INDEX "survey_responses_region_idx" ON "survey_responses"("region");

-- CreateIndex
CREATE INDEX "survey_responses_organizationId_idx" ON "survey_responses"("organizationId");

-- CreateIndex
CREATE INDEX "survey_answers_responseId_idx" ON "survey_answers"("responseId");

-- CreateIndex
CREATE INDEX "survey_answers_questionId_idx" ON "survey_answers"("questionId");

-- CreateIndex
CREATE INDEX "survey_answers_organizationId_idx" ON "survey_answers"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "survey_answers_responseId_questionId_key" ON "survey_answers"("responseId", "questionId");

-- CreateIndex
CREATE INDEX "expert_interviews_organizationId_idx" ON "expert_interviews"("organizationId");

-- CreateIndex
CREATE INDEX "expert_interviews_interviewDate_idx" ON "expert_interviews"("interviewDate");

-- CreateIndex
CREATE INDEX "expert_interviews_isDeleted_idx" ON "expert_interviews"("isDeleted");

-- AddForeignKey
ALTER TABLE "survey_templates" ADD CONSTRAINT "survey_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_questions" ADD CONSTRAINT "survey_questions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "survey_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_questions" ADD CONSTRAINT "survey_questions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "survey_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_answers" ADD CONSTRAINT "survey_answers_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "survey_responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_answers" ADD CONSTRAINT "survey_answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "survey_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_answers" ADD CONSTRAINT "survey_answers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expert_interviews" ADD CONSTRAINT "expert_interviews_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
