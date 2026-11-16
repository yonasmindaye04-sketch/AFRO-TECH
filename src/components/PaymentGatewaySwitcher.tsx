import { useEffect, useMemo, useState } from 'react';
import {
  evaluateGatewayReadiness,
  formatMpesaMsisdnPreview,
  GATEWAY_REQUIREMENTS,
  SERVICE_PAYMENT_PROVIDERS,
  type PaymentPlanMode,
  type ServicePaymentErrors,
  type ServicePaymentProvider,
} from '../utils/serviceCheckout';

type GatewayModeMap = Partial<Record<ServicePaymentProvider, 'live' | 'sandbox'>>;

export interface PaymentGatewaySwitcherProps {
  provider: ServicePaymentProvider;
  onSelectProvider: (provider: ServicePaymentProvider) => void;
  serviceId: number;
  paymentPlan: PaymentPlanMode;
  customAmount: string;
  fullName: string;
  email: string;
  phone: string;
  notes: string;
  errors: ServicePaymentErrors;
  onPhoneChange: (value: string) => void;
  onNotesChange: (value: string) => void;
}

export function PaymentGatewaySwitcher({
  provider,
  onSelectProvider,
  serviceId,
  paymentPlan,
  customAmount,
  fullName,
  email,
  phone,
  notes,
  errors,
  onPhoneChange,
  onNotesChange,
}: PaymentGatewaySwitcherProps): JSX.Element {
  const [gatewayModes, setGatewayModes] = useState<GatewayModeMap>({});

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      SERVICE_PAYMENT_PROVIDERS.map(async (rail) => {
        try {
          const res = await fetch(rail.configEndpoint);
          const data = await res.json().catch(() => null);
          if (res.ok && data?.mode) {
            return [rail.id, data.mode as 'live' | 'sandbox'] as const;
          }
        } catch {
          // Ignore transient config check failure
        }
        return [rail.id, 'sandbox' as const] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      setGatewayModes(Object.fromEntries(entries) as GatewayModeMap);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const spec = GATEWAY_REQUIREMENTS[provider];
  const activeMode = gatewayModes[provider] ?? 'sandbox';

  const readiness = useMemo(
    () =>
      evaluateGatewayReadiness({
        provider,
        serviceId,
        paymentPlan,
        customAmount,
        fullName,
        email,
        phone,
        notes,
      }),
    [provider, serviceId, paymentPlan, customAmount, fullName, email, phone, notes],
  );

  const mpesaPreview = provider === 'mpesa' ? formatMpesaMsisdnPreview(phone) : null;

  return (
    <div className="pgs-root" data-testid="payment-gateway-switcher">
      {/* 1. Dynamic Gateway Selector */}
      <div className="form-group">
        <span className="chapa-field-caption">Select Payment Gateway</span>
        <div className="chapa-rail-grid" role="radiogroup" aria-label="Payment gateway">
          {SERVICE_PAYMENT_PROVIDERS.map((rail) => {
            const isSelected = provider === rail.id;
            const mode = gatewayModes[rail.id];
            return (
              <button
                key={rail.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                data-testid={`pay-rail-${rail.id}`}
                className={`chapa-rail-btn pgs-rail-card ${isSelected ? 'active' : ''}`}
                onClick={() => onSelectProvider(rail.id)}
              >
                <div className="pgs-rail-top">
                  <i className={rail.icon} aria-hidden="true" />
                  <span>{rail.label}</span>
                </div>
                <small className="pgs-rail-sub">
                  {mode === 'live' ? 'Live API' : rail.requiresPhone ? 'Phone req.' : 'Multi-rail'}
                </small>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Dynamic Gateway Requirements Panel */}
      <div
        className="pgs-req-panel"
        role="region"
        aria-label={`${spec.displayName} requirements`}
        aria-live="polite"
        data-testid="gateway-requirements-panel"
        data-provider={provider}
      >
        <div className="pgs-req-head">
          <div>
            <div className="pgs-req-title">{spec.displayName}</div>
            <div className="pgs-req-summary">{spec.railSummary}</div>
          </div>
          <span className={`pgs-mode-tag ${activeMode}`}>
            {activeMode === 'live' ? 'Live Gateway' : 'Sandbox Mode'}
          </span>
        </div>

        <div className="pgs-spec-grid">
          <div className="pgs-spec-item">
            <span className="pgs-spec-k">Checkout Flow</span>
            <strong className="pgs-spec-v">{spec.flowTitle}</strong>
          </div>
          <div className="pgs-spec-item">
            <span className="pgs-spec-k">Security</span>
            <strong className="pgs-spec-v">{spec.securityProtocol}</strong>
          </div>
          <div className="pgs-spec-item">
            <span className="pgs-spec-k">Amount Rule</span>
            <strong className="pgs-spec-v">{spec.amountRule}</strong>
          </div>
        </div>

        <div className="pgs-req-columns">
          <div>
            <div className="pgs-block-label">Gateway Requirements</div>
            <ul className="pgs-req-list">
              {spec.requirements.map((item) => (
                <li key={item}>
                  <i className="fa-solid fa-angle-right" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="pgs-block-label">Readiness Check</div>
            <ul className="pgs-check-list" data-testid="gateway-readiness-list">
              {readiness.map((chk) => (
                <li
                  key={chk.id}
                  className={chk.met ? 'met' : chk.required ? 'pending-req' : 'pending-opt'}
                >
                  <i
                    className={
                      chk.met
                        ? 'fa-solid fa-circle-check'
                        : chk.required
                          ? 'fa-regular fa-circle'
                          : 'fa-solid fa-circle-info'
                    }
                    aria-hidden="true"
                  />
                  <span>{chk.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* 3. Gateway-Specific Input Fields */}
      <div className="form-row">
        <div className={`form-group ${errors.phone ? 'has-error' : ''}`}>
          <label htmlFor="pay-phone">
            {spec.phoneLabel}{' '}
            {spec.phoneRequired ? (
              <span className="req">*</span>
            ) : (
              <span className="chapa-optional">(optional)</span>
            )}
          </label>
          <input
            id="pay-phone"
            type="tel"
            required={spec.phoneRequired}
            placeholder={spec.phonePlaceholder}
            value={phone}
            onChange={(e) => onPhoneChange(e.target.value)}
            aria-invalid={Boolean(errors.phone)}
            aria-describedby={errors.phone ? 'pay-phone-error' : 'pay-phone-hint'}
            className={errors.phone ? 'input-error' : ''}
          />
          {errors.phone ? (
            <span id="pay-phone-error" className="field-error" role="alert">
              <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" /> {errors.phone}
            </span>
          ) : (
            <span id="pay-phone-hint" className="pgs-field-hint">
              {mpesaPreview
                ? `Normalized STK destination: +${mpesaPreview}`
                : spec.phoneHint}
            </span>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="pay-notes">
            {spec.referenceLabel} <span className="chapa-optional">(max {spec.referenceMaxLen} chars)</span>
          </label>
          <input
            id="pay-notes"
            type="text"
            maxLength={spec.referenceMaxLen}
            placeholder={spec.referencePlaceholder}
            value={notes}
            onChange={(e) => onNotesChange(e.target.value.slice(0, spec.referenceMaxLen))}
          />
          <span className="pgs-field-hint">
            {notes.length}/{spec.referenceMaxLen} characters · {spec.settlementNote}
          </span>
        </div>
      </div>
    </div>
  );
}
