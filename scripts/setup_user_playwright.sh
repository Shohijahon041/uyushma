#!/bin/bash
mkdir -p /opt/uyushma/.cache
cp -rn /root/.cache/ms-playwright /opt/uyushma/.cache/
chown -R uyushma:uyushma /opt/uyushma/.cache
ls -la /opt/uyushma/.cache/ms-playwright

