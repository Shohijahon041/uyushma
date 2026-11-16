#!/bin/bash
systemctl list-unit-files | grep -E "uyushma|gps|h02|gateway|bull"
ls -la /etc/systemd/system/ | grep -E "uyushma|gps|h02|gateway"
