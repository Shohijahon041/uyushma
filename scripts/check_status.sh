#!/bin/bash
sudo -u postgres psql -d uyushma -c "\d \"Waybill\""
sudo -u postgres psql -d uyushma -c "\d \"Driver\""
sudo -u postgres psql -d uyushma -c "\d \"Vehicle\""
sudo -u postgres psql -d uyushma -c "\d vehicles"
