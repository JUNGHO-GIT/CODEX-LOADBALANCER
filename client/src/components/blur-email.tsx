// 1. Email label check ―――――――――――――――――――――――――――――――――――――――――――――――――――――――
export function isEmailLabel(label: string | null | undefined, email: string | null | undefined): boolean {
  return !!label && !!email && label === email;
}
