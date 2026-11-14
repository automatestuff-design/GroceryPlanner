import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { Button, Muted } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { font, radius, space, useTheme } from "@/theme";

/**
 * Passwordless sign-in: we email a 6-digit code. Codes work the same on iOS,
 * Android and desktop, with no deep-link setup, and a new email creates an account.
 */
export default function SignIn() {
  const c = useTheme();
  const { sendCode, verifyCode } = useAuth();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong"); } finally { setBusy(false); }
  }

  const input = [styles.input, { color: c.text, backgroundColor: c.surface }];

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.wrap, { backgroundColor: c.bg }]}>
      <View style={styles.card}>
        <Text style={[styles.title, { color: c.text }]}>Dinner, sorted.</Text>
        <Muted>Plan the week in a quick chat, for just you or the whole family.</Muted>

        {step === "email" ? (
          <>
            <TextInput
              value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor={c.muted}
              autoCapitalize="none" autoComplete="email" keyboardType="email-address" inputMode="email" style={input}
              onSubmitEditing={() => run(async () => { await sendCode(email.trim()); setStep("code"); })}
            />
            <Button label={busy ? "Sending…" : "Email me a code"} disabled={busy || !email.includes("@")}
              onPress={() => run(async () => { await sendCode(email.trim()); setStep("code"); })} />
          </>
        ) : (
          <>
            <Muted>We sent a 6-digit code to {email}.</Muted>
            <TextInput
              value={code} onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))} placeholder="123456" placeholderTextColor={c.muted}
              keyboardType="number-pad" inputMode="numeric" autoComplete="one-time-code" textContentType="oneTimeCode" style={[input, styles.code]}
              onSubmitEditing={() => run(() => verifyCode(email.trim(), code))}
            />
            <Button label={busy ? "Checking…" : "Sign in"} disabled={busy || code.length !== 6} onPress={() => run(() => verifyCode(email.trim(), code))} />
            <Button label="Use a different email" variant="ghost" onPress={() => { setStep("email"); setCode(""); }} />
          </>
        )}
        {error && <Text style={{ color: c.warn }}>{error}</Text>}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center", padding: space.xl },
  card: { gap: space.lg, maxWidth: 420, width: "100%", alignSelf: "center" },
  title: { fontSize: 32, fontWeight: "800" },
  input: { borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.md, fontSize: font.body },
  code: { fontSize: 24, letterSpacing: 8, textAlign: "center" },
});
