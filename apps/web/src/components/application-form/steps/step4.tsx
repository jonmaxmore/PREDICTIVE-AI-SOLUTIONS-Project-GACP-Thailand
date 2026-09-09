import {
  KATORLOR1_PLANT_MATERIAL_ROWS,
  MaterialOrigin,
  PlantMaterialKind,
  Purpose,
} from '@gacp/contracts';
import {
  addPlantMaterial,
  removePlantMaterial,
  savePurposes,
} from '@/app/applicant/applications/actions.ts';
import {
  formStepTitles,
  materialOriginLabels,
  messages,
  plantMaterialKindLabels,
  purposeLabels,
} from '@/messages/th.ts';
import { AutosaveForm } from '../autosave-form.tsx';
import { ConfirmSubmitButton } from '../confirm-submit-button.tsx';
import { FootNav } from '../form-shell.tsx';
import { PlusIcon } from '../icons.tsx';
import {
  AsideCard,
  Card,
  CardHeading,
  FieldLabel,
  Hint,
  Note,
  Pill,
  SelectInput,
  smallButtonOutlineClassName,
  Tag,
  TextInput,
} from '../primitives.tsx';
import { TextCard } from '../step-aside.tsx';
import { type StepPageContext, stepPath } from './context.ts';

// ขั้นที่ 4 พันธุ์และวัตถุประสงค์ (กทล.1 ส่วนที่ ๒ ข้อ ๓) กรอกอย่างเดียว ไม่มีอัปโหลด ตามแบบจริง
export function Step4Main({ context }: { readonly context: StepPageContext }) {
  const { application, editable, errorCode } = context;
  const step4 = messages.form.step4;
  const materials = application.plantMaterials;
  const showAppendixNote = materials.length > KATORLOR1_PLANT_MATERIAL_ROWS;

  return (
    <>
      <AutosaveForm
        id="step-4-form"
        action={savePurposes.bind(null, application.id)}
        savedLabel={messages.form.autosaved}
        savingLabel={messages.form.saving}
      >
        <Card>
          <CardHeading
            title={
              <>
                {step4.purposesTitle}{' '}
                <span className="text-[13px] font-normal text-quiet">
                  {messages.form.chooseOneOrMore}
                </span>
              </>
            }
            reference={step4.purposesReference}
          />
          <div className="flex flex-wrap gap-2.5">
            {Object.values(Purpose).map((value) => (
              <Pill
                key={value}
                name="purposes"
                value={value}
                checked={application.purposes.includes(value)}
                label={purposeLabels[value]}
              />
            ))}
          </div>
          {application.purposes.includes(Purpose.EXPORT) ? (
            <Note tone="warn" className="mt-3.5">
              {step4.exportNote}
            </Note>
          ) : null}
        </Card>
      </AutosaveForm>

      <Card className="mt-4">
        <CardHeading
          title={step4.materialsTitle}
          reference={step4.materialsReference}
          lead={step4.materialsLead}
        />
        {materials.length === 0 ? (
          <p className="text-sm text-muted">{step4.noMaterials}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-[12.5px] font-semibold text-muted">
                  <th className="border-b border-border px-2.5 py-2">{step4.kind}</th>
                  <th className="border-b border-border px-2.5 py-2">{step4.varietyName}</th>
                  <th className="border-b border-border px-2.5 py-2">{step4.source}</th>
                  <th className="border-b border-border px-2.5 py-2">{step4.origin}</th>
                  <th className="border-b border-border px-2.5 py-2">{step4.quantity}</th>
                  <th className="border-b border-border px-2.5 py-2" />
                </tr>
              </thead>
              <tbody>
                {materials.map((material) => (
                  <tr key={material.id} className="align-top">
                    <td className="border-b border-border-soft px-2.5 py-2.5">
                      {plantMaterialKindLabels[material.kind]}
                    </td>
                    <td className="border-b border-border-soft px-2.5 py-2.5 font-semibold">
                      {material.varietyName}
                    </td>
                    <td className="border-b border-border-soft px-2.5 py-2.5">{material.source}</td>
                    <td className="border-b border-border-soft px-2.5 py-2.5">
                      {material.origin ? (
                        <Tag tone="quiet">
                          {materialOriginLabels[material.origin]}
                          {material.originCountry ? ` · ${material.originCountry}` : ''}
                        </Tag>
                      ) : null}
                    </td>
                    <td className="border-b border-border-soft px-2.5 py-2.5">
                      {material.quantity !== null
                        ? `${Number(material.quantity).toLocaleString('en-US')} ${material.unit ?? ''}`.trim()
                        : ''}
                    </td>
                    <td className="border-b border-border-soft px-2.5 py-2.5 text-right">
                      {editable ? (
                        <form action={removePlantMaterial.bind(null, application.id)}>
                          <input type="hidden" name="materialId" value={material.id} />
                          <ConfirmSubmitButton
                            confirmText={`${step4.removeMaterial} ${material.varietyName}`}
                            className="text-xs text-quiet hover:text-danger hover:underline"
                          >
                            {step4.removeMaterial}
                          </ConfirmSubmitButton>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {editable ? (
          <form
            action={addPlantMaterial.bind(null, application.id)}
            className="mt-4 rounded-md border border-dashed border-border bg-paper px-4 py-3.5"
          >
            <p className="text-[13px] font-semibold text-ink">{step4.addMaterialTitle}</p>
            <div className="mt-3 grid gap-x-4 gap-y-3 md:grid-cols-6">
              <div className="md:col-span-2">
                <FieldLabel htmlFor="kind" required>
                  {step4.kind}
                </FieldLabel>
                <SelectInput name="kind" defaultValue={PlantMaterialKind.SEED}>
                  {Object.values(PlantMaterialKind).map((value) => (
                    <option key={value} value={value}>
                      {plantMaterialKindLabels[value]}
                    </option>
                  ))}
                </SelectInput>
              </div>
              <div className="md:col-span-4">
                <FieldLabel htmlFor="varietyName" required>
                  {step4.varietyName}
                </FieldLabel>
                <TextInput name="varietyName" maxLength={200} />
              </div>
              <div className="md:col-span-3">
                <FieldLabel htmlFor="source" required>
                  {step4.source}
                </FieldLabel>
                <TextInput name="source" maxLength={200} />
              </div>
              <div className="md:col-span-1">
                <FieldLabel htmlFor="origin" required>
                  {step4.origin}
                </FieldLabel>
                <SelectInput name="origin" defaultValue={MaterialOrigin.DOMESTIC}>
                  {Object.values(MaterialOrigin).map((value) => (
                    <option key={value} value={value}>
                      {materialOriginLabels[value]}
                    </option>
                  ))}
                </SelectInput>
              </div>
              <div className="md:col-span-2">
                <FieldLabel htmlFor="originCountry" optional>
                  {step4.originCountry}
                </FieldLabel>
                <TextInput name="originCountry" maxLength={100} />
              </div>
              <div className="md:col-span-2">
                <FieldLabel htmlFor="quantity" optional>
                  {step4.quantity}
                </FieldLabel>
                <TextInput name="quantity" inputMode="decimal" />
              </div>
              <div className="md:col-span-2">
                <FieldLabel htmlFor="unit" optional>
                  {step4.unit}
                </FieldLabel>
                <TextInput name="unit" maxLength={30} />
              </div>
              <div className="flex items-end md:col-span-2">
                <button type="submit" className={smallButtonOutlineClassName}>
                  <PlusIcon size={14} />
                  {step4.addMaterial}
                </button>
              </div>
            </div>
            {errorCode === 'material' ? <Hint tone="danger">{step4.materialInvalid}</Hint> : null}
          </form>
        ) : null}

        {showAppendixNote ? (
          <Note tone="info" className="mt-3.5">
            {step4.appendixNote(materials.length, KATORLOR1_PLANT_MATERIAL_ROWS)}
          </Note>
        ) : null}
        <Note tone="quiet" className="mt-2.5">
          {step4.noUploads}
        </Note>
      </Card>

      <FootNav
        backHref={stepPath(application.id, 3)}
        backLabel={messages.form.backToStep(3, formStepTitles[3])}
        nextFormId="step-4-form"
        nextLabel={messages.form.nextToStep(5, formStepTitles[5])}
      />
    </>
  );
}

export function Step4Aside({ context }: { readonly context: StepPageContext }) {
  const { application } = context;
  const step4 = messages.form.step4;
  const complete = application.purposes.length > 0 && application.plantMaterials.length > 0;
  return (
    <>
      <AsideCard title={messages.form.inThisStep}>
        <div className="flex flex-col gap-2 text-[13px]">
          <div className="flex items-start gap-2">
            <Tag tone={complete ? 'ok' : 'warn'}>
              {complete ? step4.complete : `${application.purposes.length > 0 ? 1 : 0}/2`}
            </Tag>
            <span>
              {step4.summary(application.purposes.length, application.plantMaterials.length)}
            </span>
          </div>
          <div className="flex items-start gap-2">
            <Tag tone="quiet">0</Tag>
            <span>{messages.form.noDocumentsInStep}</span>
          </div>
        </div>
      </AsideCard>
      <TextCard title={step4.declarationReminderTitle} body={step4.declarationReminderBody} />
      <TextCard title={step4.importedTitle} body={step4.importedBody} />
    </>
  );
}
