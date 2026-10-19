'use client';

import { Input } from '@/components/ui/input';
import { DocumentUpload, type UploadedDocument } from '@/components/app/document-upload';
import { Field } from '@/components/app/field';
import type { ReferenceData } from '@/lib/ui/reference';

/**
 * What a credential has to be sent with, so that somebody can check it.
 *
 * A NIN or a licence number is, in the end, checked against a record — and the
 * product cannot look at that record itself yet (no provider is switched on).
 * So an officer checks by reading a photograph of the slip or licence beside the
 * number. A number alone left them nothing to read, and they went elsewhere to
 * look it up and typed the answer in. The form now asks for the photograph
 * while that is true, and stops asking once a provider can check the number.
 *
 * One definition, used by the form and by the answer to "send what the reviewer
 * asked for", so the two cannot disagree about what a complete submission is.
 */
export interface EvidenceRule {
  referenceLabel: string;
  referencePlaceholder: string;
  referenceHint?: string;
  /** A NIN has a shape; a licence number does not. */
  isNin: boolean;
  referenceRequired: boolean;
  documentLabel: string;
  documentPrompt: string;
  documentHint: string;
  documentRequired: boolean;
  /** Why a photograph is wanted, in the practitioner's terms. */
  why?: string;
}

export function evidenceRule(
  method: string,
  verification: ReferenceData['verification'] | undefined,
): EvidenceRule {
  if (method === 'nimc_verification') {
    return {
      referenceLabel: 'National Identification Number',
      referencePlaceholder: '11 digits',
      referenceHint: 'The 11-digit number on your NIN slip or ID card.',
      isNin: true,
      referenceRequired: true,
      documentLabel: 'Photograph of your NIN slip or ID card',
      documentPrompt: 'Attach a photograph of your NIN slip',
      documentHint: 'A clear photograph or PDF, up to 10 MB. The name and number must be readable.',
      documentRequired: !verification?.identityAutomated,
      why: verification?.identityAutomated
        ? undefined
        : 'An officer reads this beside your number to confirm it. Once they have, only the last four digits of the number are kept.',
    };
  }

  if (method === 'mdcn_status_check') {
    return {
      referenceLabel: 'Licence number',
      referencePlaceholder: 'MDCN/12345',
      referenceHint: 'The number on your annual practising licence.',
      isNin: false,
      referenceRequired: true,
      documentLabel: 'Photograph or scan of your practising licence',
      documentPrompt: 'Attach your practising licence',
      documentHint:
        'A clear photograph or PDF, up to 10 MB. The number, name and expiry date must be readable.',
      documentRequired: !verification?.registrationAutomated,
      why: verification?.registrationAutomated
        ? undefined
        : 'An officer reads this beside your number to confirm it, and takes the expiry date from it.',
    };
  }

  // A document-reviewed credential: the document is the evidence and any
  // reference is a convenience.
  return {
    referenceLabel: 'Reference number',
    referencePlaceholder: 'If the document has one',
    isNin: false,
    referenceRequired: false,
    documentLabel: 'Document',
    documentPrompt: 'Attach your certificate',
    documentHint: 'A PDF or a clear photograph, up to 10 MB. It goes straight to storage.',
    documentRequired: true,
  };
}

/** The digits of a NIN, with the spaces and dashes people type taken out. */
export function ninDigits(value: string): string {
  return value.replace(/[\s-]/g, '');
}

export function referenceProblem(rule: EvidenceRule, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (rule.isNin && !/^\d{11}$/.test(ninDigits(trimmed))) {
    return 'A National Identification Number is 11 digits.';
  }
  return null;
}

/** What to send: the digits of a NIN, otherwise the number as typed. */
export function referenceToSend(rule: EvidenceRule, value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return rule.isNin ? ninDigits(trimmed) : trimmed;
}

/** Whether what has been entered is a complete submission. */
export function isComplete(
  rule: EvidenceRule,
  referenceNumber: string,
  document: UploadedDocument | null,
): boolean {
  const hasReference = Boolean(referenceNumber.trim());
  if (rule.referenceRequired && !hasReference) return false;
  if (referenceProblem(rule, referenceNumber)) return false;
  if (rule.documentRequired && !document) return false;
  return true;
}

/**
 * Why a submission cannot be sent yet, in words, for the line beside the button.
 *
 * A disabled button that says nothing leaves a person guessing which of two fields it is waiting
 * for. `null` when nothing is missing.
 */
export function whatIsMissing(
  rule: EvidenceRule,
  referenceNumber: string,
  document: UploadedDocument | null,
): string | null {
  const missing: string[] = [];
  if (rule.referenceRequired && !referenceNumber.trim()) missing.push(rule.referenceLabel);
  if (rule.documentRequired && !document) missing.push(rule.documentLabel);
  if (missing.length > 0) return `Still needed: ${missing.join(' and ')}.`;
  if (referenceProblem(rule, referenceNumber)) return 'Correct the number above to send it.';
  return null;
}

export function EvidenceFields({
  rule,
  idPrefix,
  referenceNumber,
  onReferenceNumber,
  document,
  onDocument,
  referenceOptionalNote,
}: {
  rule: EvidenceRule;
  idPrefix: string;
  referenceNumber: string;
  onReferenceNumber: (value: string) => void;
  document: UploadedDocument | null;
  onDocument: (value: UploadedDocument | null) => void;
  /** Overrides "required" on the number — when answering a request, it is only wanted if it was wrong. */
  referenceOptionalNote?: string;
}) {
  const problem = referenceProblem(rule, referenceNumber);
  const documentLabelId = `${idPrefix}-document-label`;
  const documentWhyId = `${idPrefix}-document-why`;

  const reference = (
    <Field
      label={rule.referenceLabel}
      required={rule.referenceRequired && !referenceOptionalNote}
      optional={!rule.referenceRequired || Boolean(referenceOptionalNote)}
      hint={
        referenceOptionalNote
          ? `Only if the one you sent was wrong${rule.referenceHint ? `. ${rule.referenceHint}` : '.'}`
          : rule.referenceHint
      }
      error={problem ?? undefined}
    >
      <Input
        id={`${idPrefix}-reference`}
        value={referenceNumber}
        inputMode={rule.isNin ? 'numeric' : undefined}
        autoComplete="off"
        onChange={(event) => onReferenceNumber(event.target.value)}
        placeholder={rule.referencePlaceholder}
      />
    </Field>
  );

  return (
    <>
      {/* Document-reviewed credentials lead with the document; the others lead
          with the number, which is what the photograph is read against. */}
      {rule.referenceRequired ? reference : null}

      <div className="flex min-w-0 flex-col gap-1.5">
        <p id={documentLabelId} className="text-base font-medium leading-snug">
          {rule.documentLabel}
          {rule.documentRequired ? (
            <>
              <span className="text-destructive-text" aria-hidden="true">
                {' '}
                *
              </span>
              <span className="sr-only"> (required)</span>
            </>
          ) : (
            <span className="font-normal text-muted-foreground"> (optional)</span>
          )}
        </p>
        <DocumentUpload
          endpoint="/api/v1/credentials/document-upload-url"
          value={document}
          onUploaded={onDocument}
          label={rule.documentPrompt}
          hint={rule.documentHint}
          labelledBy={documentLabelId}
          describedBy={rule.why ? documentWhyId : undefined}
        />
        {rule.why ? (
          <p id={documentWhyId} className="text-sm leading-snug text-muted-foreground">
            {rule.why}
          </p>
        ) : null}
      </div>

      {!rule.referenceRequired ? reference : null}
    </>
  );
}
