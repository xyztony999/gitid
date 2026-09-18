import { createApp } from 'vue';
import Antd from 'ant-design-vue';
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import 'ant-design-vue/dist/reset.css';
import App from './App.vue';

dayjs.locale('zh-cn');

createApp(App).use(Antd, { locale: zhCN }).mount('#app');
