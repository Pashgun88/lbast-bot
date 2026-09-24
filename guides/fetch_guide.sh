#!/bin/sh
# Читает гайд из ЖГ игры в виде текста: guides/fetch_guide.sh <st_id>
# Страницы блогов отдаются без авторизации, поэтому браузер (и профиль Chrome) не нужен --
# можно читать гайды, пока сценарий работает.
set -e
curl -s --max-time 30 "http://lbast.ru/zhg_web.php?st_id=$1" \
  | sed -e 's/<br[^>]*>/\n/gI' -e 's/<\/p>/\n/gI' -e 's/<[^>]*>//g' \
  | sed 's/&nbsp;/ /g; s/&quot;/"/g; s/&amp;/\&/g; s/&laquo;/«/g; s/&raquo;/»/g; s/&#187;/»/g; s/&#171;/«/g; s/&mdash;/—/g; s/&ndash;/–/g' \
  | grep -v '^[[:space:]]*$' \
  | sed 's/.*Все сообщения[A-Za-z0-9_]*//'
