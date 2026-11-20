import { env } from "../config/env.js";

export function assertSmsConfigured() {
  if (env.SMS_MODE === "live") {
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) {
      throw Object.assign(new Error("SMS verification is unavailable until live SMS delivery is configured."), {
        status: 503,
        code: "SMS_NOT_CONFIGURED"
      });
    }
    return;
  }

  if (env.SMS_MODE === "mock" && env.NODE_ENV !== "production") {
    return;
  }

  throw Object.assign(new Error("SMS verification is unavailable until live SMS delivery is configured."), {
    status: 503,
    code: "SMS_NOT_CONFIGURED"
  });
}

export async function sendOtpSms(phone: string, code: string) {
  if (env.SMS_MODE === "mock" && env.NODE_ENV !== "production") {
    return;
  }

  assertSmsConfigured();
  const accountSid = env.TWILIO_ACCOUNT_SID!;
  const credentials = Buffer.from(`${accountSid}:${env.TWILIO_AUTH_TOKEN!}`).toString("base64");
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      To: phone,
      From: env.TWILIO_FROM_NUMBER!,
      Body: `Aarogya Drishti verification code: ${code}. It expires in 5 minutes.`
    })
  });
  if (!response.ok) {
    throw Object.assign(new Error("The verification message could not be delivered."), {
      status: 502,
      code: "SMS_DELIVERY_FAILED"
    });
  }
}
