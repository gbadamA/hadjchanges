/** @type {import('next').NextConfig} */
const nextConfig = {
  // Sortie « standalone » : Next produit un serveur autonome avec seulement les
  // dépendances réellement utilisées. Sans elle, l'image Docker embarquerait
  // tout `node_modules` — plusieurs centaines de Mo pour rien.
  output: 'standalone',
};

export default nextConfig;
