FROM postgres:17.6-alpine
LABEL maintainer="Ozren Dabić (dabico@usi.ch)"

ENV TZ=UTC \
    DATA_DIRECTORY=/docker-entrypoint-initdb.d

WORKDIR $DATA_DIRECTORY

COPY schema/migrations/001_study_foundation.sql ./001_study_foundation.sql

WORKDIR /

HEALTHCHECK \
  --start-period=60s \
  --interval=10s \
  --timeout=5s \
  --retries=5 \
CMD pg_isready -U $POSTGRES_USER -d $POSTGRES_DB
