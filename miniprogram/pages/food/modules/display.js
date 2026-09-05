function createDisplayMethods({ app, dateUtils, mediaService }) {
  return {
    resolveRecordImages(records, includeRecipe = false) {
      const keys = [];
      records.forEach(record => {
        (record.dishes || []).forEach(dish => {
          const key = dish.imageKey || dish.image;
          if (key) keys.push(key);
          if (includeRecipe) {
            const recipeKey = dish.recipeImageKey || dish.recipeImage;
            if (recipeKey) keys.push(recipeKey);
          }
        });
      });
      return mediaService.resolveFiles(keys, { variant: includeRecipe ? 'original' : 'thumbnail' }).then(urls => records.map(record => ({
        ...record,
        dishes: (record.dishes || []).map(dish => {
          const imageKey = dish.imageKey || dish.image || '';
          const recipeImageKey = dish.recipeImageKey || dish.recipeImage || '';
          return {
            ...dish,
            imageKey,
            image: urls[imageKey] || '',
            recipeImageKey,
            recipeImage: includeRecipe ? (urls[recipeImageKey] || '') : ''
          };
        })
      })));
    },

    prepareRecordsForDisplay(records, currentRecords) {
      const currentById = new Map((currentRecords || []).map(record => [String(record._id), record]));
      return records.map(record => {
        const current = currentById.get(String(record._id));
        return {
          ...record,
          dishes: (record.dishes || []).map(dish => {
            const imageKey = dish.imageKey || dish.image || '';
            const recipeImageKey = dish.recipeImageKey || dish.recipeImage || '';
            const currentDish = (current?.dishes || []).find(item =>
              String(item.id || item.name) === String(dish.id || dish.name)
            );
            return {
              ...dish,
              imageKey,
              image: (currentDish?.imageKey || '') === imageKey ? (currentDish?.image || '') : '',
              recipeImageKey,
              recipeImage: (currentDish?.recipeImageKey || '') === recipeImageKey
                ? (currentDish?.recipeImage || '')
                : ''
            };
          })
        };
      });
    },

    formatOrdersTime(orders) {
      const currentUserId = String(app.globalData.userInfo?.id || app.globalData.userId || '');
      return orders.map(order => {
        const isMine = String(order.authorId || '') === currentUserId;
        const isAcceptedByMe = String(order.acceptedByUserId || '') === currentUserId;
        let date = null;
        if (order.createTime && typeof order.createTime === 'object' && order.createTime.toDate) {
          date = order.createTime.toDate();
        } else if (order.createTime) {
          date = dateUtils.parseDateTime(order.createTime);
        }
        return {
          ...order,
          menuName: Array.isArray(order.menuNames) ? order.menuNames.join('、') : (order.menuName || ''),
          formattedTime: this.formatDate(date),
          isMine,
          isAcceptedByMe,
          nextActionText: order.status === 'completed'
            ? '这份点单已完成，制作说明仍可回看'
            : order.status === 'ready'
              ? (isMine ? '已经做好了，收到后点「收到啦」完成订单' : '已做好，等待下单人确认收到')
              : order.status === 'accepted'
                ? (isAcceptedByMe ? '按制作说明准备，完成后点「已做好」' : '对方正在准备，做好后会更新到这里')
                : (isMine ? '等待对方接单；接单前可以撤回' : '接下这份点单，就可以开始准备了'),
          statusText: order.status === 'completed'
            ? '已完成'
            : order.status === 'ready'
              ? '待确认'
              : order.status === 'accepted'
                ? '制作中'
                : '待接单'
        };
      });
    },

    formatDate(date) {
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '刚刚';
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${month}-${day} ${hours}:${minutes}`;
    }
  };
}

module.exports = createDisplayMethods;
