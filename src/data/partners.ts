export type LogoItem = {
  name: string;
  image: string;
  href?: string;
  subtitle?: string;
};

export const partners: LogoItem[] = [
  {
    name: "OxiBio",
    image: "/assets/partners/oxibio.png",
    href: "https://oxibio.com.ar/",
    subtitle: "Ingeniería hospitalaria",
  },
  {
    name: "Cobra Power Gym",
    image: "/assets/partners/cobra-gym.svg",
    subtitle: "Rosario",
  },
  {
    name: "Red TL 105.5",
    image: "/assets/partners/redtl.png",
    href: "https://www.redtl.com.ar/",
    subtitle: "La ciudad pasa por acá",
  },
];

export const clients: LogoItem[] = [
  {
    name: "Sanatorio Mapaci",
    image: "/assets/clientes/mapaci.png",
    href: "https://www.mapaci.com.ar/",
    subtitle: "Rosario",
  },
  {
    name: "FUNAL",
    image: "/assets/clientes/funal.png",
    href: "https://funalsrl.com.ar/",
    subtitle: "Cliente destacado",
  },
  {
    name: "Hospital de Niños Zona Norte",
    image: "/assets/clientes/zona-norte.svg",
    subtitle: "Rosario",
  },
  {
    name: "Hospital Dr. Anselmo Gamen",
    image: "/assets/clientes/gamen.png",
    href: "https://www.hospitalgamen.org/",
    subtitle: "Villa Gobernador Gálvez",
  },
];
