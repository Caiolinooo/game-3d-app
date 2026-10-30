FROM node:20-alpine

WORKDIR /code
ENV NODE_ENV=production
ENV PORT=3000

COPY package.json ./
COPY dist ./dist

EXPOSE 3000
CMD ["node", "dist/boot.js"]
