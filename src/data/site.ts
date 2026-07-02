export const site = {
  name: "Gasonor S.R.L.",
  tagline: "Droguería de Gases Medicinales",
  subtitle: "Provisión de Gases Comprimidos",
  description:
    "Más de 60 años en Rosario. Oxigenoterapia domiciliaria, gases medicinales e industriales, reguladores y helio para eventos.",
  url: "https://www.gasonorsrl.com.ar",
  address: "Dr. Riva 1215, Matheu, Rosario, Santa Fe",
  phones: ["(0341) 464-9500", "(0341) 464-9504"],
  whatsapp: "5493415989500",
  whatsappDisplay: "+54 9 341 598-9500",
  email: "info@gasonorsrl.com.ar",
  hours: {
    weekdays: "Lunes a Viernes: 9:15 a 17:00 hs",
    saturday: "Sábados: guardia ambulancias y atención general 9:00 a 12:00 hs",
    sunday: "Domingos: cerrado",
  },
  facebook: "https://www.facebook.com/pages/GASO-NOR-SRL/119519078119186",
  coverage: "Rosario y alrededores",
} as const;

export function whatsappLink(message?: string) {
  const text = message
    ? `?text=${encodeURIComponent(message)}`
    : "";
  return `https://wa.me/${site.whatsapp}${text}`;
}
